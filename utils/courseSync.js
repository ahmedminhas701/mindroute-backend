const Course = require('../models/Course');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const { notifyStudents, notifyTeacher } = require('./notify');

function subjectTeacherMap(batch) {
  const m = batch && batch.subjectTeachers;
  if (!m) return new Map();
  return m instanceof Map ? m : new Map(Object.entries(m));
}

/** Teacher id the batch assigns to `subject`, or ''. */
function teacherForSubject(batch, subject) {
  return subjectTeacherMap(batch).get(subject) || '';
}

async function enrollStudentsInBatchCourses(studentIds, batchId) {
  if (!studentIds || !studentIds.length || !batchId) return;
  const courses = await Course.find({ batchId }, { id: 1 }).lean();
  const ids = courses.map(c => c.id);
  if (!ids.length) return;
  await Student.updateMany(
    { id: { $in: studentIds } },
    { $addToSet: { enrolledCourseIds: { $each: ids } } }
  );
}

async function revokeStudentsFromBatchCourses(studentIds, batchId) {
  if (!studentIds || !studentIds.length || !batchId) return;
  const courses = await Course.find({ batchId }, { id: 1 }).lean();
  const ids = courses.map(c => c.id);
  if (!ids.length) return;
  await Student.updateMany(
    { id: { $in: studentIds } },
    { $pull: { enrolledCourseIds: { $in: ids } } }
  );
}

/** Re-point every course in the batch at whoever the batch now assigns, and tell both teachers. */
async function syncBatchCourseTeachers(batch) {
  const courses = await Course.find({ batchId: batch.id });
  for (const course of courses) {
    const wanted = teacherForSubject(batch, course.subject);
    const previous = course.teacher || '';
    if (previous === wanted) continue;
    course.teacher = wanted;
    await course.save();
    if (previous) {
      await Teacher.updateOne({ id: previous }, { $pull: { courseIds: course.id } });
      await notifyTeacher(previous, { type: 'change', title: 'Course reassigned', body: `You are no longer assigned to ${esc(course.title)} (${batch.name}).` });
    }
    if (wanted) {
      await Teacher.updateOne({ id: wanted }, { $addToSet: { courseIds: course.id } });
      await notifyTeacher(wanted, { type: 'change', title: 'New course assigned', body: `You have been assigned to teach ${esc(course.title)} in ${batch.name}.` });
    }
  }
}

/** Put a student in exactly one batch (by name), or none if ''. Keeps rosters, enrolment and labels in step. */
async function assignStudentToBatch(studentId, batchName) {
  const Batch = require('../models/Batch');
  const target = batchName ? await Batch.findOne({ name: batchName }) : null;

  const current = await Batch.find({ studentIds: studentId });
  for (const b of current) {
    if (target && b.id === target.id) continue;
    b.studentIds = b.studentIds.filter(id => id !== studentId);
    await b.save();
    await revokeStudentsFromBatchCourses([studentId], b.id);
    await notifyStudents([studentId], { type: 'change', title: 'Removed from a batch', body: `You are no longer in ${esc(b.name)}, and its courses are no longer available to you.` });
  }

  if (target) {
    const joined = !target.studentIds.includes(studentId);
    if (joined) { target.studentIds.push(studentId); await target.save(); }
    await enrollStudentsInBatchCourses([studentId], target.id);
    await Student.updateOne({ id: studentId }, { $set: { batch: target.name, entryTest: target.entryTest } });
    if (joined) {
      const n = await Course.countDocuments({ batchId: target.id });
      await notifyStudents([studentId], { type: 'change', title: 'Added to a batch', body: `You have been added to ${target.name}. ${n} course${n === 1 ? ' is' : 's are'} now available on your Courses page.` });
    }
  } else {
    await Student.updateOne({ id: studentId }, { $set: { batch: '', entryTest: '' } });
  }
}

module.exports = {
  teacherForSubject,
  enrollStudentsInBatchCourses,
  revokeStudentsFromBatchCourses,
  syncBatchCourseTeachers,
  assignStudentToBatch,
};