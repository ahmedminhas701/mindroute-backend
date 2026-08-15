const express = require('express');
const router = express.Router();

const Subject = require('../models/Subject');
const Teacher = require('../models/Teacher');
const Batch = require('../models/Batch');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

// GET /api/subjects — every role reads this (teacher form, batch form, entry test form)
router.get('/', async (req, res) => {
  const subjects = await Subject.find({}).sort({ name: 1 });
  res.json(subjects);
});

// POST /api/subjects — admin adds a new offered subject
router.post('/', restrictTo('admin'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Subject name is required.' });
    const subject = await Subject.create({ name: name.trim() });
    res.status(201).json(subject);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'That subject already exists.' });
    res.status(400).json({ message: 'Failed to add subject.', error: err.message });
  }
});

// DELETE /api/subjects/:id — blocked for core subjects. For non-core ones,
// cascades cleanly: pulls it out of every teacher's subjects list and every
// batch's subjectTeachers map, so nothing is left pointing at a subject
// that no longer exists.
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  const subject = await Subject.findById(req.params.id);
  if (!subject) return res.status(404).json({ message: 'Subject not found.' });
  if (subject.isCore) return res.status(400).json({ message: 'Core subjects cannot be removed.' });

  await Teacher.updateMany({}, { $pull: { subjects: subject.name } });

  const batches = await Batch.find({ [`subjectTeachers.${subject.name}`]: { $exists: true } });
  for (const b of batches) {
    b.subjectTeachers.delete(subject.name);
    await b.save();
  }

  await subject.deleteOne();
  res.json({ message: 'Subject removed.' });
});

module.exports = router;