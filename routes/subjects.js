const express = require('express');
const router = express.Router();

const Subject = require('../models/Subject');
const Teacher = require('../models/Teacher');
const Batch = require('../models/Batch');
const Course = require('../models/Course');
const EntryTest = require('../models/EntryTest');
const { protect, restrictTo } = require('../middleware/auth');
const V = require('../utils/validate');

router.use(protect);

// ── Why this collection is the backbone of the whole app ─────────────────────
//
// Subject is the root of the chain that makes a course visible to anybody:
//
//   Subject -> EntryTest.subjects[] -> Course.subject
//           -> Teacher.subjects[]   -> Batch.subjectTeachers{subject: teacherId}
//           -> Student.enrolledCourseIds
//
// Every one of those links is matched by exact, case-sensitive string equality.
// Break any link and the affected course simply stops appearing — for the
// student, for the teacher, or both — with no error logged anywhere. That's why
// the UI now offers a dropdown fed from this endpoint instead of a text box, and
// why creating a subject is the FIRST thing an admin needs to be able to do.
//
// Before this rewrite there was no UI calling POST or DELETE here at all: the
// only subjects that could ever exist were the ones hard-coded in seed.js. That
// is precisely the pressure that kept free-text subject inputs alive — if the
// dropdown can't be added to, people need a way around it.

/**
 * Normalise a subject name to Title Case.
 *
 * Case normalisation is not cosmetic here. Storing 'biology' and 'Biology' as
 * two separate subjects creates two parallel, half-populated worlds: a course
 * under one, a teacher under the other, and no join between them. Forcing one
 * canonical casing on the way in means the exact-match comparisons downstream
 * can actually succeed.
 */
function normalizeSubjectName(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Subject name is required.' };
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (!cleaned) return { ok: false, error: 'Subject name is required.' };
  if (cleaned.length < 2) return { ok: false, error: 'Subject name is too short.' };
  if (cleaned.length > 40) return { ok: false, error: 'Subject name is too long (max 40 characters).' };
  if (!/^[A-Za-z][A-Za-z0-9 &.\-/]*$/.test(cleaned)) {
    return { ok: false, error: 'Subject name must start with a letter and use only letters, numbers, spaces, & . - and /.' };
  }
  // Title Case, but leave an all-caps word alone so 'IT' doesn't become 'It'
  // and 'MDCAT English' keeps its shape.
  const name = cleaned.split(' ').map(w => {
    if (w.length > 1 && w === w.toUpperCase() && /[A-Z]{2}/.test(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
  return { ok: true, name };
}

/** Everything currently referencing a subject name, for in-use warnings. */
async function findUsage(name) {
  const [teachers, courses, tests, batches] = await Promise.all([
    Teacher.find({ subjects: name }, { id: 1, name: 1 }).lean(),
    Course.find({ subject: name }, { id: 1, title: 1 }).lean(),
    EntryTest.find({ subjects: name }, { id: 1, name: 1 }).lean(),
    Batch.find({ [`subjectTeachers.${name}`]: { $exists: true } }, { id: 1, name: 1 }).lean(),
  ]);
  return {
    teachers: teachers.map(t => t.name || t.id),
    courses: courses.map(c => c.title || c.id),
    entryTests: tests.map(t => t.name || t.id),
    batches: batches.map(b => b.name || b.id),
    total: teachers.length + courses.length + tests.length + batches.length,
  };
}

// GET /api/subjects — read by every role: the teacher form, the batch form, the
// entry-test form and the course form all build their <select> from this.
router.get('/', async (req, res) => {
  try {
    const subjects = await Subject.find({}).sort({ name: 1 }).lean();

    if (req.query.withUsage === 'true' && req.user.role === 'admin') {
      const withUsage = await Promise.all(
        subjects.map(async s => ({ ...s, usage: await findUsage(s.name) }))
      );
      return res.json(withUsage);
    }
    res.json(subjects);
  } catch (err) {
    console.error('GET /subjects failed:', err);
    res.status(500).json({ message: 'Failed to fetch subjects.' });
  }
});

// POST /api/subjects — admin adds a new offered subject.
router.post('/', restrictTo('admin'), async (req, res) => {
  try {
    const norm = normalizeSubjectName(req.body.name);
    if (!norm.ok) return res.status(400).json({ message: norm.error, errors: { name: norm.error } });

    // Catch a case-variant duplicate before the unique index does. The index is
    // case-SENSITIVE, so it would happily accept 'biology' alongside 'Biology' —
    // exactly the split-world problem this route exists to prevent. Normalising
    // makes that rare, but an existing lowercase row from older data would
    // still slip through without this check.
    const existing = await Subject.findOne({ name: new RegExp('^' + V.escapeRegex(norm.name) + '$', 'i') }).lean();
    if (existing) {
      return res.status(409).json({
        message: `"${existing.name}" already exists.`,
        errors: { name: 'This subject already exists.' },
        subject: existing,
      });
    }

    const subject = await Subject.create({ name: norm.name, isCore: false });
    res.status(201).json(subject);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'That subject already exists.' });
    console.error('POST /subjects failed:', err);
    res.status(400).json({ message: 'Failed to add subject.' });
  }
});

// PATCH /api/subjects/:id — rename, cascading the new name everywhere.
//
// Without the cascade a rename is a data-corruption button: the Subject row says
// 'Physics II' while every course, teacher and batch still says 'Physics 2', and
// none of them match any more.
router.patch('/:id', restrictTo('admin'), async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);
    if (!subject) return res.status(404).json({ message: 'Subject not found.' });

    const norm = normalizeSubjectName(req.body.name);
    if (!norm.ok) return res.status(400).json({ message: norm.error, errors: { name: norm.error } });
    if (norm.name === subject.name) return res.json(subject);   // nothing to do

    const clash = await Subject.findOne({
      _id: { $ne: subject._id },
      name: new RegExp('^' + V.escapeRegex(norm.name) + '$', 'i'),
    }).lean();
    if (clash) {
      return res.status(409).json({ message: `"${clash.name}" already exists.`, errors: { name: 'This subject already exists.' } });
    }

    const oldName = subject.name;
    subject.name = norm.name;
    await subject.save();

    // Cascade, in the same order the chain is traversed at read time.
    const [teacherRes, courseRes, testRes] = await Promise.all([
      Teacher.updateMany({ subjects: oldName }, { $set: { 'subjects.$[el]': norm.name } }, { arrayFilters: [{ el: oldName }] }),
      Course.updateMany({ subject: oldName }, { $set: { subject: norm.name } }),
      EntryTest.updateMany({ subjects: oldName }, { $set: { 'subjects.$[el]': norm.name } }, { arrayFilters: [{ el: oldName }] }),
    ]);

    // subjectTeachers is a Map, so the key itself has to be rewritten — there's
    // no $rename for a dynamic map key, hence the read-modify-write.
    const batches = await Batch.find({ [`subjectTeachers.${oldName}`]: { $exists: true } });
    for (const b of batches) {
      const map = b.subjectTeachers instanceof Map ? b.subjectTeachers : new Map(Object.entries(b.subjectTeachers || {}));
      const plain = {};
      map.forEach((tid, key) => { plain[key === oldName ? norm.name : key] = tid; });
      b.subjectTeachers = plain;
      await b.save();
    }

    res.json({
      subject,
      renamedFrom: oldName,
      cascaded: {
        teachers: teacherRes.modifiedCount,
        courses: courseRes.modifiedCount,
        entryTests: testRes.modifiedCount,
        batches: batches.length,
      },
    });
  } catch (err) {
    console.error('PATCH /subjects/:id failed:', err);
    res.status(400).json({ message: 'Failed to rename subject.' });
  }
});

// DELETE /api/subjects/:id
//
// Blocked for core subjects. For anything else, refuses by default when the
// subject is in use and reports exactly what depends on it, so an admin can't
// silently empty out a course by removing the subject underneath it. Resend with
// ?force=true to delete anyway, which cascades the removal.
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);
    if (!subject) return res.status(404).json({ message: 'Subject not found.' });
    if (subject.isCore) {
      return res.status(400).json({ message: `"${subject.name}" is a core subject and cannot be removed.` });
    }

    const usage = await findUsage(subject.name);
    if (usage.total > 0 && req.query.force !== 'true') {
      const parts = [];
      if (usage.courses.length)    parts.push(`${usage.courses.length} course(s): ${usage.courses.join(', ')}`);
      if (usage.teachers.length)   parts.push(`${usage.teachers.length} teacher(s): ${usage.teachers.join(', ')}`);
      if (usage.entryTests.length) parts.push(`${usage.entryTests.length} entry test(s): ${usage.entryTests.join(', ')}`);
      if (usage.batches.length)    parts.push(`${usage.batches.length} batch(es): ${usage.batches.join(', ')}`);
      return res.status(409).json({
        message: `"${subject.name}" is still in use by ${parts.join('; ')}. ` +
                 `Delete or reassign those first — removing the subject now would make those courses stop appearing for students and teachers.`,
        usage,
      });
    }

    // Cascade so nothing is left pointing at a subject that no longer exists.
    await Teacher.updateMany({}, { $pull: { subjects: subject.name } });

    const batches = await Batch.find({ [`subjectTeachers.${subject.name}`]: { $exists: true } });
    for (const b of batches) {
      const map = b.subjectTeachers instanceof Map ? b.subjectTeachers : new Map(Object.entries(b.subjectTeachers || {}));
      const plain = {};
      map.forEach((tid, key) => { if (key !== subject.name) plain[key] = tid; });
      b.subjectTeachers = plain;
      await b.save();
    }
    await EntryTest.updateMany({}, { $pull: { subjects: subject.name } });

    await subject.deleteOne();
    res.json({ message: `"${subject.name}" removed.`, cascaded: usage });
  } catch (err) {
    console.error('DELETE /subjects/:id failed:', err);
    res.status(500).json({ message: 'Failed to remove subject.' });
  }
});

module.exports = router;
