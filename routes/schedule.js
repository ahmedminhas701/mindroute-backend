const express = require('express');
const router = express.Router();

const TeacherSchedule = require('../models/TeacherSchedule');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

// GET /api/schedule — everyone reads this (student "today's classes" widget too)
// optional ?day=Monday filter, matching renderDayClasses()/renderSchedule()
router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.day) filter.day = req.query.day;
  if (req.query.teacherId) filter.teacherId = req.query.teacherId;
  const rows = await TeacherSchedule.find(filter).sort({ day: 1, time: 1 });
  res.json(rows);
});

// GET /api/schedule/:id
router.get('/:id', async (req, res) => {
  const row = await TeacherSchedule.findById(req.params.id);
  if (!row) return res.status(404).json({ message: 'Class not found.' });
  res.json(row);
});

// POST /api/schedule — mirrors submitAddClass() (create branch, app.js §19)
router.post('/', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const row = await TeacherSchedule.create(req.body);
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ message: 'Failed to create class.', error: err.message });
  }
});

// PUT /api/schedule/:id — mirrors submitAddClass() (edit branch)
router.put('/:id', restrictTo('admin', 'teacher'), async (req, res) => {
  const row = await TeacherSchedule.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!row) return res.status(404).json({ message: 'Class not found.' });
  res.json(row);
});

// DELETE /api/schedule/:id — mirrors deleteClass()
router.delete('/:id', restrictTo('admin', 'teacher'), async (req, res) => {
  const row = await TeacherSchedule.findByIdAndDelete(req.params.id);
  if (!row) return res.status(404).json({ message: 'Class not found.' });
  res.json({ message: 'Class removed.' });
});

module.exports = router;
