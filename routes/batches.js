const express = require('express');
const router = express.Router();

const Batch = require('../models/Batch');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const EntryTest = require('../models/EntryTest');
const Course = require('../models/Course');
const { protect, restrictTo } = require('../middleware/auth');
const { nextId } = require('../utils/nextId');

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
    values: {
      name, status, studentIds, subjectTeachers,
      entryTestId: entryTest.id,
      entryTest: entryTest.name,
      startDate: typeof raw.startDate === 'string' ? raw.startDate : '',
    },
  };
}

async function enrollStudentsInBatchCourses(studentIds, entryTestId, batchId) {
  if (!studentIds?.length || !entryTestId || !batchId) return;
  const entryTest = await EntryTest.findOne({ id: entryTestId });
  if (!entryTest) return;
  // Scoped to THIS batch's courses only — a course with a matching subject
  // that belongs to a different batch must never enroll these students.
  const courses = await Course.find({ subject: { $in: entryTest.subjects }, batchId });
  const courseIds = courses.map(c => c.id);
  if (!courseIds.length) return;
  await Student.updateMany(
    { id: { $in: studentIds } },
    { $addToSet: { enrolledCourseIds: { $each: courseIds } } }
  );
}

/**
 * The reverse of enrollStudentsInBatchCourses(): pulls out only the courses
 * that belong to the given entry test's subjects, leaving anything else the
 * student has untouched. Used when a student is removed from a batch (or the
 * batch is deleted, or the batch's entry test changes) — without this, a
 * removed student keeps indefinite access to a course they were only ever
 * granted through batch membership.
 */
async function revokeStudentsFromBatchCourses(studentIds, entryTestId, batchId) {
  if (!studentIds?.length || !entryTestId || !batchId) return;
  const entryTest = await EntryTest.findOne({ id: entryTestId });
  if (!entryTest) return;
  const courses = await Course.find({ subject: { $in: entryTest.subjects }, batchId });
  const courseIds = courses.map(c => c.id);
  if (!courseIds.length) return;
  await Student.updateMany(
    { id: { $in: studentIds } },
    { $pull: { enrolledCourseIds: { $in: courseIds } } }
  );
}

// GET /api/batches
router.get('/', async (req, res) => {
  const batches = await Batch.find({}).sort({ startDate: -1 });
  res.json(batches.map(serialize));
});

// GET /api/batches/:id
router.get('/:id', restrictTo('admin', 'teacher'), async (req, res) => {
  const batch = await Batch.findOne({ id: req.params.id });
  if (!batch) return res.status(404).json({ message: 'Batch not found.' });
  res.json(serialize(batch));
});

// GET /api/batches/:id/students
router.get('/:id/students', restrictTo('admin', 'teacher'), async (req, res) => {
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
        { $set: { batch: cleaned.values.name } }
      );
    }
    await enrollStudentsInBatchCourses(cleaned.values.studentIds, cleaned.values.entryTestId);
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
    const oldEntryTestId = existing.entryTestId;
    const oldName = existing.name;

    const cleaned = await cleanBatchBody(res, req.body, { existingId: existing.id });
    if (!cleaned) return;

    Object.assign(existing, cleaned.values);
    await existing.save();

    const newStudentIds = cleaned.values.studentIds;
    const newEntryTestId = cleaned.values.entryTestId;

    if (newStudentIds.length) {
      await Student.updateMany(
        { id: { $in: newStudentIds } },
        { $set: { batch: cleaned.values.name } }
      );
    }

    // Students dropped from the roster lose the access this batch granted them.
    const removedStudentIds = oldStudentIds.filter(id => !newStudentIds.includes(id));
    if (removedStudentIds.length) {
      await revokeStudentsFromBatchCourses(removedStudentIds, oldEntryTestId);
      // Only clear the display fields if they still point at THIS batch — a
      // student someone else already reassigned in between shouldn't be reset.
      await Student.updateMany(
        { id: { $in: removedStudentIds }, batch: oldName },
        { $set: { batch: '', entryTest: '' } }
      );
    }

    // If the entry test itself changed, remaining students only have a
    // legitimate claim to the NEW subjects — revoke the old ones before
    // re-enrolling, or they keep indefinite access to a program this batch no
    // longer represents.
    if (oldEntryTestId && newEntryTestId && oldEntryTestId !== newEntryTestId && newStudentIds.length) {
      await revokeStudentsFromBatchCourses(newStudentIds, oldEntryTestId);
    }

    await enrollStudentsInBatchCourses(newStudentIds, newEntryTestId);

    res.json(serialize(existing));
  } catch (err) {
    console.error('PUT /batches/:id failed:', err);
    res.status(400).json({ message: 'Failed to update batch.' });
  }
});

// DELETE /api/batches/:id
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  const batch = await Batch.findOneAndDelete({ id: req.params.id });
  if (!batch) return res.status(404).json({ message: 'Batch not found.' });

  if (batch.studentIds && batch.studentIds.length) {
    await revokeStudentsFromBatchCourses(batch.studentIds, batch.entryTestId);
    await Student.updateMany(
      { id: { $in: batch.studentIds }, batch: batch.name },
      { $set: { batch: '', entryTest: '' } }
    );
  }

  res.json({ message: 'Batch deleted.', revokedFrom: batch.studentIds || [] });
});

module.exports = router;
module.exports.enrollStudentsInBatchCourses = enrollStudentsInBatchCourses;
module.exports.revokeStudentsFromBatchCourses = revokeStudentsFromBatchCourses;