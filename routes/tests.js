const express = require('express');
const router = express.Router();

const EntryTest = require('../models/EntryTest');
const Course = require('../models/Course');
const Batch = require('../models/Batch');
const { protect, restrictTo } = require('../middleware/auth');
const V = require('../utils/validate');
const { resolveSubjectsOr400 } = require('../utils/subjects');

router.use(protect);

const COLORS = ['#1B5FAD', '#0E8A5F', '#C47C08', '#7c3aed', '#C0392B', '#0369A1'];

// Fields a client may set. `id` and `color` are server-assigned; accepting them
// from the body let a caller overwrite another test's id.
const TEST_WRITABLE = ['name', 'desc', 'subjects'];

function cleanName(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'Entry test name is required.' };
  const name = raw.trim().replace(/\s+/g, ' ').toUpperCase();
  if (name.length < 2)  return { ok: false, error: 'Entry test name is too short.' };
  if (name.length > 30) return { ok: false, error: 'Entry test name is too long (max 30 characters).' };
  if (!/^[A-Z][A-Z0-9 &.\-]*$/.test(name)) {
    return { ok: false, error: 'Entry test name must start with a letter and use only letters, numbers, spaces, & . and -.' };
  }
  return { ok: true, name };
}

// GET /api/tests — every role reads this (batch creation, dashboards, etc.)
router.get('/', async (req, res) => {
  try {
    const tests = await EntryTest.find({}).sort({ name: 1 });
    res.json(tests);
  } catch (err) {
    console.error('GET /tests failed:', err);
    res.status(500).json({ message: 'Failed to fetch entry tests.' });
  }
});

// GET /api/tests/:id
router.get('/:id', async (req, res) => {
  try {
    const test = await EntryTest.findOne({ id: req.params.id });
    if (!test) return res.status(404).json({ message: 'Entry test not found.' });
    res.json(test);
  } catch (err) {
    console.error('GET /tests/:id failed:', err);
    res.status(500).json({ message: 'Failed to load entry test.' });
  }
});

// POST /api/tests — body: { name, desc, subjects: [] }
router.post('/', restrictTo('admin'), async (req, res) => {
  try {
    const body = V.pick(req.body, TEST_WRITABLE);

    const nameR = cleanName(body.name);
    if (!nameR.ok) return res.status(400).json({ message: nameR.error, errors: { name: nameR.error } });

    if (!Array.isArray(body.subjects) || !body.subjects.length) {
      return res.status(400).json({
        message: 'Choose at least one subject for this entry test.',
        errors: { subjects: 'Choose at least one subject.' },
      });
    }
    // Resolve to canonical spelling. An entry test whose subjects[] doesn't
    // exactly match Course.subject makes every course under it invisible on the
    // student's Courses page — that's the whole reason this check exists.
    const subjects = await resolveSubjectsOr400(res, body.subjects, 'Subject');
    if (!subjects) return;

    // Reject a duplicate by NAME, not just by slug. 'MDCAT' and 'mdcat ' both
    // slugify to 'mdcat', and the old code responded by silently creating
    // 'mdcat_1' — two entry tests with the same displayed name, which is
    // indistinguishable to the admin and splits batches across both.
    const dup = await EntryTest.findOne({ name: new RegExp('^' + V.escapeRegex(nameR.name) + '$', 'i') }).lean();
    if (dup) {
      return res.status(409).json({
        message: `An entry test called "${dup.name}" already exists.`,
        errors: { name: 'This entry test already exists.' },
      });
    }

    const baseId = nameR.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    let id = baseId || 'test';
    let suffix = 1;
    while (await EntryTest.exists({ id })) id = `${baseId}_${suffix++}`;

    const count = await EntryTest.countDocuments();
    const test = await EntryTest.create({
      id,
      name: nameR.name,
      color: COLORS[count % COLORS.length],
      desc: typeof body.desc === 'string' && body.desc.trim()
        ? body.desc.trim().slice(0, 200)
        : 'Entry test preparation program',
      subjects,
    });
    res.status(201).json(test);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'An entry test with this name already exists.' });
    }
    console.error('POST /tests failed:', err);
    res.status(400).json({ message: 'Failed to create entry test.' });
  }
});

// PUT /api/tests/:id — general field edit
router.put('/:id', restrictTo('admin'), async (req, res) => {
  try {
    const test = await EntryTest.findOne({ id: req.params.id });
    if (!test) return res.status(404).json({ message: 'Entry test not found.' });

    const body = V.pick(req.body, TEST_WRITABLE);

    if (body.name !== undefined) {
      const nameR = cleanName(body.name);
      if (!nameR.ok) return res.status(400).json({ message: nameR.error, errors: { name: nameR.error } });
      const dup = await EntryTest.findOne({
        id: { $ne: test.id },
        name: new RegExp('^' + V.escapeRegex(nameR.name) + '$', 'i'),
      }).lean();
      if (dup) return res.status(409).json({ message: `An entry test called "${dup.name}" already exists.`, errors: { name: 'This entry test already exists.' } });

      // Batch.entryTest stores the display name as a denormalised copy. Renaming
      // the test without updating it left every batch showing the old name.
      if (nameR.name !== test.name) {
        await Batch.updateMany({ entryTestId: test.id }, { $set: { entryTest: nameR.name } });
      }
      test.name = nameR.name;
    }
    if (body.desc !== undefined) {
      test.desc = String(body.desc).trim().slice(0, 200);
    }
    if (body.subjects !== undefined) {
      const subjects = await resolveSubjectsOr400(res, body.subjects, 'Subject');
      if (!subjects) return;
      if (!subjects.length) {
        return res.status(400).json({ message: 'An entry test needs at least one subject.', errors: { subjects: 'Choose at least one subject.' } });
      }
      test.subjects = subjects;
    }

    await test.save();
    res.json(test);
  } catch (err) {
    console.error('PUT /tests/:id failed:', err);
    res.status(400).json({ message: 'Failed to update entry test.' });
  }
});

// PUT /api/tests/:id/subjects — full replace of the subject list.
router.put('/:id/subjects', restrictTo('admin'), async (req, res) => {
  try {
    const test = await EntryTest.findOne({ id: req.params.id });
    if (!test) return res.status(404).json({ message: 'Entry test not found.' });

    const incoming = Array.isArray(req.body.subjects) ? req.body.subjects : [];
    if (!incoming.length) {
      // The old route accepted `subjects: []` and wiped the list. An entry test
      // with no subjects makes every course beneath it vanish from the student
      // and teacher course pages at once, with nothing to indicate why.
      return res.status(400).json({
        message: 'An entry test must keep at least one subject.',
        errors: { subjects: 'Choose at least one subject.' },
      });
    }

    const subjects = await resolveSubjectsOr400(res, incoming, 'Subject');
    if (!subjects) return;

    // Warn before removing a subject that courses are currently filed under.
    const removed = (test.subjects || []).filter(s => !subjects.includes(s));
    if (removed.length && req.query.force !== 'true') {
      const affected = await Course.find({ subject: { $in: removed } }, { title: 1 }).lean();
      if (affected.length) {
        return res.status(409).json({
          message: `Removing ${removed.join(', ')} would hide ${affected.length} course(s) from students and teachers: ` +
                   `${affected.map(c => c.title).join(', ')}. Move or delete those courses first, or resend with ?force=true.`,
          affectedCourses: affected.map(c => c.title),
        });
      }
    }

    test.subjects = subjects;
    await test.save();
    res.json(test);
  } catch (err) {
    console.error('PUT /tests/:id/subjects failed:', err);
    res.status(400).json({ message: 'Failed to update subjects.' });
  }
});

// DELETE /api/tests/:id
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  try {
    const inUse = await Batch.find({ entryTestId: req.params.id }, { name: 1 }).lean();
    if (inUse.length) {
      return res.status(409).json({
        message: `Cannot remove this entry test — ${inUse.length} batch(es) still use it: ` +
                 `${inUse.map(b => b.name).join(', ')}. Delete or reassign those batches first.`,
      });
    }
    const test = await EntryTest.findOneAndDelete({ id: req.params.id });
    if (!test) return res.status(404).json({ message: 'Entry test not found.' });
    res.json({ message: 'Entry test removed.' });
  } catch (err) {
    console.error('DELETE /tests/:id failed:', err);
    res.status(500).json({ message: 'Failed to remove entry test.' });
  }
});

module.exports = router;
