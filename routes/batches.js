const V = require('../utils/validate');
const express = require('express');
const router = express.Router();


const Batch = require('../models/Batch');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const EntryTest = require('../models/EntryTest');
const Course = require('../models/Course');
const { protect, restrictTo } = require('../middleware/auth');
const { nextId } = require('../utils/nextId');
const {
  enrollStudentsInBatchCourses,
  revokeStudentsFromBatchCourses,
  syncBatchCourseTeachers,
} = require('../utils/courseSync');
const { notifyStudents, notifyTeacher } = require('../utils/notify');

/** Tells teachers about subject assignments that changed. Subjects that already have a course are
 *  skipped, because syncBatchCourseTeachers already sends a more specific "course" notice. */
async function notifyTeacherAssignments(oldMap, newMap, batchName, skipSubjects) {
  const subjects = new Set([...Object.keys(oldMap || {}), ...Object.keys(newMap || {})]);
  for (const subject of subjects) {
    if (skipSubjects.has(subject)) continue;
    const was = (oldMap || {})[subject] || '';
    const now = (newMap || {})[subject] || '';
    if (was === now) continue;
    if (now) await notifyTeacher(now, { type: 'change', title: 'Subject assigned', body: `You have been assigned to teach ${subject} in ${batchName}.` });
    if (was) await notifyTeacher(was, { type: 'change', title: 'Subject unassigned', body: `You are no longer assigned to teach ${subject} in ${batchName}.` });
  }
}


router.use(protect);

function serialize(batch) {
  const obj = batch.toObject();
  obj.subjectTeachers = obj.subjectTeachers instanceof Map
    ? Object.fromEntries(obj.subjectTeachers)
    : obj.subjectTeachers;
  return obj;
}

const BATCH_WRITABLE = ['name', 'entryTestId', 'startDate', 'status', 'studentIds', 'subjectTeachers'];

function pick(obj, keys) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  keys.forEach(k => { if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]; });
  return out;
}

async function cleanBatchBody(res, body, { existingId = null } = {}) {
  const raw = pick(body, BATCH_WRITABLE);

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) {
    res.status(400).json({ message: 'Batch name is required.', errors: { name: 'Batch name is required.' } });
    return null;
  }
  if (name.length > 80) {
    res.status(400).json({ message: 'Batch name is too long (max 80 characters).', errors: { name: 'Too long.' } });
    return null;
  }
  
  if (/[<>"]/.test(name)) {
    res.status(400).json({ message: 'Batch name cannot contain < > or ".', errors: { name: 'Remove the special characters.' } });
    return null;
  }
  const startR = V.normalizeDate(raw.startDate, { label: 'Start date' });
  if (!startR.ok) {
    res.status(400).json({ message: startR.error, errors: { startDate: startR.error } });
    return null;
  }

  const dup = await Batch.findOne({
    name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'),
    ...(existingId ? { id: { $ne: existingId } } : {}),
  }).lean();
  if (dup) {
    res.status(409).json({ message: `A batch named "${dup.name}" already exists.`, errors: { name: 'This batch name is already in use.' } });
    return null;
  }

  if (!raw.entryTestId) {
    res.status(400).json({ message: 'Pick an entry test for this batch.', errors: { entryTestId: 'Pick an entry test.' } });
    return null;
  }
  const entryTest = await EntryTest.findOne({ id: raw.entryTestId });
  if (!entryTest) {
    res.status(400).json({ message: 'That entry test does not exist.', errors: { entryTestId: 'Invalid entry test.' } });
    return null;
  }

  const status = ['upcoming', 'active', 'completed'].includes(raw.status) ? raw.status : 'upcoming';

  const studentIds = Array.isArray(raw.studentIds) ? [...new Set(raw.studentIds.map(String))] : [];
  if (studentIds.length) {
    const found = await Student.find({ id: { $in: studentIds } }, { id: 1 }).lean();
    const foundIds = new Set(found.map(s => s.id));
    const missing = studentIds.filter(id => !foundIds.has(id));
    if (missing.length) {
      res.status(400).json({ message: `Unknown student id(s): ${missing.join(', ')}.`, errors: { studentIds: 'Contains an unknown student.' } });
      return null;
    }

    // A student belongs to one batch only. Two memberships would leave them
    // enrolled in both batches' courses with a single `batch` label.
    const others = await Batch.find(
      { studentIds: { $in: studentIds }, ...(existingId ? { id: { $ne: existingId } } : {}) },
      { name: 1, studentIds: 1 }
    ).lean();
    if (others.length) {
      const clashes = others.map(b => `${b.studentIds.filter(id => studentIds.includes(id)).join(', ')} (in ${esc(b.name)})`);
      res.status(409).json({
        message: `A student can only be in one batch. Already enrolled elsewhere: ${clashes.join('; ')}. Remove them from that batch first.`,
        errors: { studentIds: 'Contains a student who is already in another batch.' },
      });
      return null;
    }
  }

  const subjectTeachersIn = raw.subjectTeachers && typeof raw.subjectTeachers === 'object' ? raw.subjectTeachers : {};
  const subjectTeachers = {};
  const badSubjects = Object.keys(subjectTeachersIn).filter(s => !entryTest.subjects.includes(s));
  if (badSubjects.length) {
    res.status(400).json({
      message: `${badSubjects.join(', ')} ${badSubjects.length > 1 ? 'are' : 'is'} not part of ${entryTest.name}'s subjects.`,
      errors: { subjectTeachers: 'Contains a subject not in this entry test.' },
    });
    return null;
  }
  const teacherIds = [...new Set(Object.values(subjectTeachersIn).filter(Boolean))];
  const teachers = teacherIds.length ? await Teacher.find({ id: { $in: teacherIds } }).lean() : [];
  const teacherById = new Map(teachers.map(t => [t.id, t]));
  for (const [subject, tid] of Object.entries(subjectTeachersIn)) {
    if (!tid) continue;
    const t = teacherById.get(tid);
    if (!t) {
      res.status(400).json({ message: `Unknown teacher id "${tid}" for ${subject}.`, errors: { subjectTeachers: 'Contains an unknown teacher.' } });
      return null;
    }
    if (!(t.subjects || []).includes(subject)) {
      res.status(400).json({
        message: `${t.name} does not teach ${subject}, so they cannot be assigned to it in this batch.`,
        errors: { subjectTeachers: `${t.name} does not teach ${subject}.` },
      });
      return null;
    }
    subjectTeachers[subject] = tid;
  }

  return {
    entryTest,
    values: {
      name, status, studentIds, subjectTeachers,
      entryTestId: entryTest.id,
      entryTest: entryTest.name,
      startDate: startR.value,
    },
  };
}

// GET /api/batches
router.get('/', async (req, res) => {
  try {
    let batches = await Batch.find({}).sort({ startDate: -1 });
    if (req.user.role === 'student') {
      const me = await Student.findOne({ email: req.user.email }, { id: 1 }).lean();
      batches = batches.filter(b => me && b.studentIds.includes(me.id));
      return res.json(batches.map(b => { const o = serialize(b); delete o.studentIds; return o; }));
    }
    if (req.user.role === 'teacher') {
      const me = await Teacher.findOne({ email: req.user.email }, { id: 1 }).lean();
      batches = batches.filter(b => me && Object.values(serialize(b).subjectTeachers || {}).includes(me.id));
    }
    res.json(batches.map(serialize));
  } catch (err) {
    console.error('GET /batches failed:', err);
    res.status(500).json({ message: 'Failed to fetch batches.' });
  }
});

// GET /api/batches/:id
router.get('/:id', restrictTo('admin'), async (req, res) => {
  const batch = await Batch.findOne({ id: req.params.id });
  if (!batch) return res.status(404).json({ message: 'Batch not found.' });
  res.json(serialize(batch));
});

// GET /api/batches/:id/students
router.get('/:id/students', restrictTo('admin'), async (req, res) => {
  const batch = await Batch.findOne({ id: req.params.id });
  if (!batch) return res.status(404).json({ message: 'Batch not found.' });
  const students = await Student.find({ id: { $in: batch.studentIds } });
  res.json(students);
});

// POST /api/batches
router.post('/', restrictTo('admin'), async (req, res) => {
  const cleaned = await cleanBatchBody(res, req.body);
  if (!cleaned) return;

  try {
    const batch = await Batch.create({ id: await nextId('batch', 'B'), ...cleaned.values });

    if (cleaned.values.studentIds.length) {
      await Student.updateMany(
        { id: { $in: cleaned.values.studentIds } },
        { $set: { batch: cleaned.values.name, entryTest: cleaned.values.entryTest } }
      );
      await notifyTeacherAssignments({}, cleaned.values.subjectTeachers, cleaned.values.name, new Set());
      await notifyStudents(cleaned.values.studentIds, { type: 'change', title: 'Added to a batch', body: `You have been added to ${cleaned.values.name}. Your courses will appear on the Courses page.` });
    }
    // No enrolment here: a brand-new batch has no courses yet. Courses are
    // created per batch (Admin > Courses) and enrol the roster when created.
    res.status(201).json(serialize(batch));
  } catch (err) {
    console.error('POST /batches failed:', err);
    res.status(400).json({ message: 'Failed to create batch.' });
  }
});

// PUT /api/batches/:id
router.put('/:id', restrictTo('admin'), async (req, res) => {
  try {
    const existing = await Batch.findOne({ id: req.params.id });
    if (!existing) return res.status(404).json({ message: 'Batch not found.' });

    const oldStudentIds = [...existing.studentIds];
    const oldTeachers = serialize(existing).subjectTeachers || {};
    const oldName = existing.name;
    const oldEntryTestId = existing.entryTestId;

    const cleaned = await cleanBatchBody(res, req.body, { existingId: existing.id });
    if (!cleaned) return;

    // Switching programme is only safe if every existing course's subject is
    // still part of the new one; otherwise those courses are stranded.
    if (cleaned.values.entryTestId !== oldEntryTestId) {
      const courses = await Course.find({ batchId: existing.id }, { title: 1, subject: 1 }).lean();
      const stranded = courses.filter(c => !cleaned.entryTest.subjects.includes(c.subject));
      if (stranded.length) {
        return res.status(409).json({
          message: `${cleaned.entryTest.name} does not include ${[...new Set(stranded.map(c => c.subject))].join(', ')}, ` +
                   `so these courses would be stranded: ${stranded.map(c => c.title).join(', ')}. Delete them first.`,
          errors: { entryTestId: 'Existing courses use subjects this entry test does not have.' },
        });
      }
    }

    Object.assign(existing, cleaned.values);
    await existing.save();

    const newStudentIds = cleaned.values.studentIds;

    // Everyone currently in the batch: keep batch/entry-test labels in step
    // (this also covers a rename of the batch).
    if (newStudentIds.length) {
      await Student.updateMany(
        { id: { $in: newStudentIds } },
        { $set: { batch: cleaned.values.name, entryTest: cleaned.values.entryTest } }
      );
    }

    // Removed students lose the courses this batch gave them.
    const removed = oldStudentIds.filter(id => !newStudentIds.includes(id));
    if (removed.length) {
      await revokeStudentsFromBatchCourses(removed, existing.id);
      await Student.updateMany(
        { id: { $in: removed }, batch: { $in: [oldName, cleaned.values.name] } },
        { $set: { batch: '', entryTest: '' } }
      );
    }

    await enrollStudentsInBatchCourses(newStudentIds, existing.id);
    await syncBatchCourseTeachers(existing);
    const withCourse = new Set((await Course.find({ batchId: existing.id }, { subject: 1 }).lean()).map(c => c.subject));
    await notifyTeacherAssignments(oldTeachers, cleaned.values.subjectTeachers, cleaned.values.name, withCourse);
    const added = newStudentIds.filter(id => !oldStudentIds.includes(id));
    if (added.length)   await notifyStudents(added,   { type: 'change', title: 'Added to a batch', body: `You have been added to ${cleaned.values.name}. Your courses will appear on the Courses page.` });
    if (removed.length) await notifyStudents(removed, { type: 'change', title: 'Removed from a batch', body: `You are no longer in ${oldName}, and its courses are no longer available to you.` });

    res.json(serialize(existing));
  } catch (err) {
    console.error('PUT /batches/:id failed:', err);
    res.status(400).json({ message: 'Failed to update batch.' });
  }
});

// DELETE /api/batches/:id - a batch's courses belong to it, so they go too
// (after confirmation).
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  try {
    const batch = await Batch.findOne({ id: req.params.id });
    if (!batch) return res.status(404).json({ message: 'Batch not found.' });

    const courses = await Course.find({ batchId: batch.id }, { id: 1, title: 1, teacher: 1 })
    if (courses.length && req.query.force !== 'true') {
      return res.status(409).json({
        message: `"${batch.name}" has ${courses.length} course(s): ${courses.map(c => c.title).join(', ')}. ` +
                 `Deleting the batch also deletes them, with all their weeks, topics and content.`,
        courses: courses.map(c => c.title),
      });
    }

    const courseIds = courses.map(c => c.id);
    if (courseIds.length) {
      await Course.deleteMany({ batchId: batch.id });
      await Student.updateMany({ enrolledCourseIds: { $in: courseIds } }, { $pull: { enrolledCourseIds: { $in: courseIds } } });
      await Teacher.updateMany({ courseIds: { $in: courseIds } }, { $pull: { courseIds: { $in: courseIds } } });
    }
    if (batch.studentIds.length) {
      await Student.updateMany(
        { id: { $in: batch.studentIds }, batch: batch.name },
        { $set: { batch: '', entryTest: '' } }
      );
    }
    await notifyStudents(batch.studentIds, { type: 'change', title: 'Batch closed', body: `${batch.name} has been removed, together with its courses.` });
    for (const c of courses) if (c.teacher) await notifyTeacher(c.teacher, { type: 'change', title: 'Course removed', body: `${esc(c.title)} was removed because ${batch.name} was deleted.` });
    await batch.deleteOne();
    res.json({ message: 'Batch deleted.', coursesRemoved: courseIds.length });
  } catch (err) {
    console.error('DELETE /batches/:id failed:', err);
    res.status(500).json({ message: 'Failed to delete batch.' });
  }
});

module.exports = router;