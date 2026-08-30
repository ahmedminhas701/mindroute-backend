const express = require('express');
const router = express.Router();

const Batch = require('../models/Batch');
const Student = require('../models/Student');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

// Batch docs store subjectTeachers as a Mongoose Map; the frontend expects
// a plain object (app.js does Object.entries(b.subjectTeachers)). Convert
// on the way out everywhere — see TECHNICAL_REFERENCE note on models/Batch.js.
function serialize(batch) {
  const obj = batch.toObject();
  obj.subjectTeachers = obj.subjectTeachers instanceof Map
    ? Object.fromEntries(obj.subjectTeachers)
    : obj.subjectTeachers;
  return obj;
}

const EntryTest = require('../models/EntryTest');
const Course = require('../models/Course');

async function enrollStudentsInBatchCourses(studentIds, entryTestId) {
  if (!studentIds?.length || !entryTestId) return;
  const entryTest = await EntryTest.findOne({ id: entryTestId });
  if (!entryTest) return;
  const courses = await Course.find({ subject: { $in: entryTest.subjects } });
  const courseIds = courses.map(c => c.id);
  if (!courseIds.length) return;
  await Student.updateMany(
    { id: { $in: studentIds } },
    { $addToSet: { enrolledCourseIds: { $each: courseIds } } }
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

// POST /api/batches — mirrors saveAdminBatch() (create branch, app.js §20)
// body: { name, entryTest, entryTestId, subjectTeachers, startDate, status, studentIds }
router.post('/', restrictTo('admin'), async (req, res) => {
  try {
    const count = await Batch.countDocuments();
    const id = 'B' + String(count + 1).padStart(3, '0');
    const batch = await Batch.create({ id, ...req.body });

    // Keep each enrolled student's `batch` display field in sync,
    // same as saveAdminBatch() does client-side.
    if (Array.isArray(req.body.studentIds) && req.body.studentIds.length) {
      await Student.updateMany(
        { id: { $in: req.body.studentIds } },
        { $set: { batch: req.body.name } }
      );
    }
    await enrollStudentsInBatchCourses(req.body.studentIds, req.body.entryTestId);
    res.status(201).json(serialize(batch));
  } catch (err) {
    res.status(400).json({ message: 'Failed to create batch.', error: err.message });
  }
});

// PUT /api/batches/:id — mirrors saveAdminBatch() (edit branch)
router.put('/:id', restrictTo('admin'), async (req, res) => {
  const batch = await Batch.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
  if (!batch) return res.status(404).json({ message: 'Batch not found.' });

  if (Array.isArray(req.body.studentIds) && req.body.name) {
    await Student.updateMany(
      { id: { $in: req.body.studentIds } },
      { $set: { batch: req.body.name } }
    );
  }
  res.json(serialize(batch));
});

// DELETE /api/batches/:id — mirrors deleteCurrentBatch()
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  const batch = await Batch.findOneAndDelete({ id: req.params.id });
  if (!batch) return res.status(404).json({ message: 'Batch not found.' });
  res.json({ message: 'Batch deleted.' });
});

module.exports = router;