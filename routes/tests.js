const express = require('express');
const router = express.Router();

const EntryTest = require('../models/EntryTest');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

const COLORS = ['#1B5FAD', '#0E8A5F', '#C47C08', '#7c3aed', '#C0392B', '#0369A1'];

// GET /api/tests — every role reads this (batch creation, dashboards, etc.)
router.get('/', async (req, res) => {
  const tests = await EntryTest.find({});
  res.json(tests);
});

// GET /api/tests/:id
router.get('/:id', async (req, res) => {
  const test = await EntryTest.findOne({ id: req.params.id });
  if (!test) return res.status(404).json({ message: 'Entry test not found.' });
  res.json(test);
});

// POST /api/tests — mirrors addTest() (app.js §20)
// body: { name, desc, subjects: [] }
// If the slugified id already exists (e.g. "NTS" vs "nts "), a numeric
// suffix is appended instead of hitting the unique-index error.
router.post('/', restrictTo('admin'), async (req, res) => {
  try {
    const { name, desc, subjects } = req.body;
    if (!name || !subjects?.length) {
      return res.status(400).json({ message: 'Name and at least one subject are required.' });
    }

    const baseId = name.toLowerCase().trim().replace(/\s+/g, '_');
    let id = baseId;
    let suffix = 1;
    while (await EntryTest.exists({ id })) {
      id = `${baseId}_${suffix++}`;
    }

    const count = await EntryTest.countDocuments();
    const test = await EntryTest.create({
      id,
      name: name.trim().toUpperCase(),
      color: COLORS[count % COLORS.length],
      desc: desc || 'Entry test preparation program',
      subjects,
    });
    res.status(201).json(test);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'An entry test with this name already exists.' });
    }
    res.status(400).json({ message: 'Failed to create entry test.', error: err.message });
  }
});

// PUT /api/tests/:id — general field edit
router.put('/:id', restrictTo('admin'), async (req, res) => {
  const test = await EntryTest.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
  if (!test) return res.status(404).json({ message: 'Entry test not found.' });
  res.json(test);
});

// PUT /api/tests/:id/subjects — mirrors saveEditTestSubjects()
// body: { subjects: [] }  (full replace, same as the client-side editor)
router.put('/:id/subjects', restrictTo('admin'), async (req, res) => {
  const test = await EntryTest.findOneAndUpdate(
    { id: req.params.id },
    { subjects: req.body.subjects || [] },
    { new: true }
  );
  if (!test) return res.status(404).json({ message: 'Entry test not found.' });
  res.json(test);
});

// DELETE /api/tests/:id — mirrors removeTest()
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  const Batch = require('../models/Batch');
  const inUse = await Batch.exists({ entryTestId: req.params.id });
  if (inUse) {
    return res.status(400).json({ message: 'Cannot remove this entry test — one or more batches still use it. Delete or reassign those batches first.' });
  }
  const test = await EntryTest.findOneAndDelete({ id: req.params.id });
  if (!test) return res.status(404).json({ message: 'Entry test not found.' });
  res.json({ message: 'Entry test removed.' });
});

module.exports = router;
