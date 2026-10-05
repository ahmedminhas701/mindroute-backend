const express = require('express');
const router = express.Router();

const Teacher = require('../models/Teacher');
const Student = require('../models/Student');
const Batch = require('../models/Batch');
const Course = require('../models/Course');
const User = require('../models/User');
const createUserAccount = require('../utils/createUserAccount');
const { protect, restrictTo } = require('../middleware/auth');
const V = require('../utils/validate');
const { nextId } = require('../utils/nextId');
const { getSubjectNames, resolveSubjectsOr400 } = require('../utils/subjects');

router.use(protect);

// `subjects` is handled separately from the rest, because it has to be checked
// against the Subject collection rather than against a regex.
const TEACHER_WRITABLE = Object.keys(V.TEACHER_RULES);

// Server-side port of getTeacherCourseIds() (app.js §4).
// A teacher is linked to a course two ways: directly via teacher.courseIds, or
// indirectly via a batch's subjectTeachers map. This merges both.
async function resolveTeacherCourseIds(teacher) {
  const ids = new Set(teacher.courseIds || []);
  const [batches, courses] = await Promise.all([Batch.find({}), Course.find({})]);
  batches.forEach(b => {
    if (!b.subjectTeachers) return;
    const map = b.subjectTeachers instanceof Map ? b.subjectTeachers : new Map(Object.entries(b.subjectTeachers));
    map.forEach((tid, subject) => {
      if (tid === teacher.id) {
        courses.forEach(c => { if (c.subject === subject) ids.add(c.id); });
      }
    });
  });
  return [...ids];
}

/** Validate + normalise a teacher payload. Returns null after sending a 400. */
async function cleanTeacherBody(res, body, { partial = false } = {}) {
  const input = V.pick(body, TEACHER_WRITABLE);
  const { ok, values, errors } = V.validate(input, V.TEACHER_RULES, { partial });
  if (!ok) {
    res.status(400).json({ message: V.firstError(errors), errors });
    return null;
  }

  // ── subjects ──
  // Not part of the rule engine because validity depends on the database, not on
  // a pattern. Resolving through the Subject collection is what guarantees the
  // stored spelling exactly matches what Course.subject and
  // Batch.subjectTeachers will be compared against — see utils/subjects.js for
  // why an exact match matters so much here.
  const sendingSubjects = Object.prototype.hasOwnProperty.call(body, 'subjects');
  if (sendingSubjects || !partial) {
    const raw = Array.isArray(body.subjects) ? body.subjects
      : (typeof body.subjects === 'string' && body.subjects.trim() ? [body.subjects] : []);
    if (!raw.length) {
      res.status(400).json({
        message: 'Select at least one subject for this teacher.',
        errors: { subjects: 'Select at least one subject.' },
      });
      return null;
    }
    const canonical = await resolveSubjectsOr400(res, raw, 'Subject');
    if (!canonical) return null;        // 400 already sent
    values.subjects = canonical;
  }

  return values;
}

// GET /api/teachers?search=
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let filter = {};
    if (search) {
      // Two fixes here. escapeRegex stops a search like "(a+)+$" from pinning
      // the event loop (see routes/students.js for the longer note), and the
      // field is `subjects`, not `subject` — the old query searched a field that
      // stopped existing when teachers gained multiple subjects, so searching
      // for "Biology" matched nothing and looked like there were no Biology
      // teachers at all.
      const re = new RegExp(V.escapeRegex(String(search).slice(0, 80)), 'i');
      filter = { $or: [{ name: re }, { subjects: re }, { email: re }, { qualification: re }] };
    }
    const teachers = await Teacher.find(filter).sort({ name: 1 });
    res.json(teachers);
  } catch (err) {
    console.error('GET /teachers failed:', err);
    res.status(500).json({ message: 'Failed to fetch teachers.' });
  }
});

// GET /api/teachers/me
router.get('/me', restrictTo('teacher'), async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ email: req.user.email });
    if (!teacher) return res.status(404).json({ message: 'Teacher record not found.' });
    res.json(teacher);
  } catch (err) {
    console.error('GET /teachers/me failed:', err);
    res.status(500).json({ message: 'Failed to load your record.' });
  }
});

// GET /api/teachers/options — dropdown data for the Add/Edit Teacher modal.
// Subjects come from the DB; the rest come from the same arrays the server
// validates against, so the form and the validator can never disagree.
router.get('/options', restrictTo('admin'), async (req, res) => {
  try {
    res.json({
      subjects: await getSubjectNames(),
      qualifications: V.QUALIFICATIONS,
      genders: V.GENDERS,
      statuses: V.STATUSES,
    });
  } catch (err) {
    console.error('GET /teachers/options failed:', err);
    res.status(500).json({ message: 'Failed to load form options.' });
  }
});

// GET /api/teachers/:id
router.get('/:id', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ id: req.params.id });
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
    res.json(teacher);
  } catch (err) {
    console.error('GET /teachers/:id failed:', err);
    res.status(500).json({ message: 'Failed to load teacher.' });
  }
});

// GET /api/teachers/:id/courses
router.get('/:id/courses', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ id: req.params.id });
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
    if (req.user.role === 'teacher' && req.user.email !== teacher.email) {
      return res.status(403).json({ message: 'Not your record.' });
    }
    const courseIds = await resolveTeacherCourseIds(teacher);
    const courses = await Course.find({ id: { $in: courseIds } });
    res.json(courses);
  } catch (err) {
    console.error('GET /teachers/:id/courses failed:', err);
    res.status(500).json({ message: 'Failed to load courses.' });
  }
});

// GET /api/teachers/:id/students
router.get('/:id/students', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ id: req.params.id });
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
    if (req.user.role === 'teacher' && req.user.email !== teacher.email) {
      return res.status(403).json({ message: 'Not your record.' });
    }
    const courseIds = await resolveTeacherCourseIds(teacher);
    const students = await Student.find({ enrolledCourseIds: { $in: courseIds } });
    res.json(students);
  } catch (err) {
    console.error('GET /teachers/:id/students failed:', err);
    res.status(500).json({ message: 'Failed to load students.' });
  }
});

// GET /api/teachers/:id/pending-grading
router.get('/:id/pending-grading', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ id: req.params.id });
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
    // Was missing: any teacher could read any other teacher's grading queue,
    // including student names and submitted answers. Every other /:id route
    // here has this check; this one didn't.
    if (req.user.role === 'teacher' && req.user.email !== teacher.email) {
      return res.status(403).json({ message: 'Not your record.' });
    }
    const courseIds = await resolveTeacherCourseIds(teacher);
    const students = await Student.find({ 'assignments.courseId': { $in: courseIds } });

    const pending = [];
    students.forEach(s => {
      s.assignments
        .filter(a => courseIds.includes(a.courseId) && a.submitted && !a.approved)
        .forEach(a => pending.push({ ...a.toObject(), studentId: s.id, studentName: s.name }));
    });
    res.json(pending);
  } catch (err) {
    console.error('GET /teachers/:id/pending-grading failed:', err);
    res.status(500).json({ message: 'Failed to load the grading queue.' });
  }
});

// POST /api/teachers — profile + matching User login, with rollback.
router.post('/', restrictTo('admin'), async (req, res) => {
  const values = await cleanTeacherBody(res, req.body);
  if (!values) return;

  const password = typeof req.body.password === 'string' ? req.body.password : undefined;
  if (password !== undefined && password.length < 6) {
    return res.status(400).json({
      message: 'Password must be at least 6 characters (or leave it blank to generate one).',
      errors: { password: 'Password must be at least 6 characters.' },
    });
  }

  const [dupTeacher, dupUser] = await Promise.all([
    Teacher.findOne({ email: values.email }, { id: 1 }).lean(),
    User.findOne({ email: values.email }, { _id: 1 }).lean(),
  ]);
  if (dupTeacher || dupUser) {
    return res.status(409).json({
      message: `That email is already registered${dupTeacher ? ' to teacher ' + dupTeacher.id : ''}.`,
      errors: { email: 'This email is already in use.' },
    });
  }
  if (values.cnic) {
    const dupCnic = await Teacher.findOne({ cnic: values.cnic }, { id: 1, name: 1 }).lean();
    if (dupCnic) {
      return res.status(409).json({
        message: `That CNIC is already recorded for ${dupCnic.name} (${dupCnic.id}).`,
        errors: { cnic: 'This CNIC is already on file.' },
      });
    }
  }

  let teacher;
  try {
    teacher = await Teacher.create({
      ...values,
      id: await nextId('teacher', 'T'),
      courseIds: [],
      joinDate: new Date().toISOString().slice(0, 10),   // sortable; was a locale string
    });
  } catch (err) {
    return res.status(400).json({ message: friendlyMongooseError(err, 'Failed to create teacher.') });
  }

  try {
    const { tempPassword } = await createUserAccount({
      name: teacher.name, email: teacher.email, role: 'teacher', password,
    });
    res.status(201).json({ teacher, tempPassword });
  } catch (err) {
    await Teacher.deleteOne({ id: teacher.id }); // rollback
    console.error('Teacher login account creation failed:', err);
    res.status(400).json({ message: 'Could not create the login account, so the teacher was not saved. Please try again.' });
  }
});

// PUT /api/teachers/:id
router.put('/:id', restrictTo('admin'), async (req, res) => {
  const values = await cleanTeacherBody(res, req.body, { partial: true });
  if (!values) return;

  try {
    const existing = await Teacher.findOne({ id: req.params.id });
    if (!existing) return res.status(404).json({ message: 'Teacher not found.' });

    if (values.email && values.email !== existing.email) {
      const [dup, dupUser] = await Promise.all([
        Teacher.findOne({ email: values.email, id: { $ne: existing.id } }, { id: 1 }).lean(),
        User.findOne({ email: values.email }, { _id: 1 }).lean(),
      ]);
      if (dup || dupUser) {
        return res.status(409).json({ message: 'That email is already registered.', errors: { email: 'This email is already in use.' } });
      }
    }

    // Dropping a subject a teacher is still assigned to in a batch would leave
    // that batch pointing at a teacher who no longer teaches it — the course
    // then silently stops appearing for them. Warn instead of corrupting.
    if (values.subjects) {
      const removed = (existing.subjects || []).filter(s => !values.subjects.includes(s));
      if (removed.length) {
        const batches = await Batch.find({});
        const conflicts = [];
        batches.forEach(b => {
          if (!b.subjectTeachers) return;
          const map = b.subjectTeachers instanceof Map ? b.subjectTeachers : new Map(Object.entries(b.subjectTeachers));
          map.forEach((tid, subject) => {
            if (tid === existing.id && removed.includes(subject)) {
              conflicts.push(`${subject} in ${b.name || b.id}`);
            }
          });
        });
        if (conflicts.length && req.query.force !== 'true') {
          return res.status(409).json({
            message: `${existing.name} is still assigned to ${conflicts.join(', ')}. ` +
                     `Reassign those first, or resend with ?force=true to remove the subject anyway.`,
            conflicts,
          });
        }
      }
    }

    const oldEmail = existing.email;
    Object.assign(existing, values);
    await existing.save();   // .save() runs validators; findOneAndUpdate did not

    if (values.email && values.email !== oldEmail) {
      await User.updateOne({ email: oldEmail }, { $set: { email: values.email } });
    }
    if (values.name) {
      await User.updateOne({ email: existing.email }, { $set: { name: existing.name } });
    }

    res.json(existing);
  } catch (err) {
    res.status(400).json({ message: friendlyMongooseError(err, 'Failed to update teacher.') });
  }
});

// DELETE /api/teachers/:id — profile, login, and every batch assignment.
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ id: req.params.id });
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });

    // Find the batches this teacher is assigned to before deleting, so the admin
    // can be told what will be left unstaffed rather than discovering it later.
    const batches = await Batch.find({});
    const orphaned = [];
    for (const b of batches) {
      if (!b.subjectTeachers) continue;
      const map = b.subjectTeachers instanceof Map ? b.subjectTeachers : new Map(Object.entries(b.subjectTeachers));
      let touched = false;
      map.forEach((tid, subject) => {
        if (tid === teacher.id) { orphaned.push(`${subject} in ${b.name || b.id}`); touched = true; }
      });
      if (!touched) continue;
      if (req.query.force !== 'true') continue;

      // Cascade-clean. Previously these entries stayed behind pointing at a
      // teacher row that no longer existed, so the batch page rendered
      // "undefined" as the teacher name and enrolment silently found no match.
      const plain = {};
      map.forEach((tid, subject) => { if (tid !== teacher.id) plain[subject] = tid; });
      b.subjectTeachers = plain;
      await b.save();
    }

    if (orphaned.length && req.query.force !== 'true') {
      return res.status(409).json({
        message: `${teacher.name} is currently teaching ${orphaned.join(', ')}. ` +
                 `Assign a replacement first, or resend with ?force=true to delete and leave those unstaffed.`,
        conflicts: orphaned,
      });
    }

    await Teacher.deleteOne({ id: teacher.id });
    await User.deleteOne({ email: teacher.email });
    res.json({
      message: 'Teacher removed.',
      unstaffed: orphaned,
    });
  } catch (err) {
    console.error('DELETE /teachers/:id failed:', err);
    res.status(500).json({ message: 'Failed to remove teacher.' });
  }
});

/** See routes/students.js for why raw err.message never goes to the browser. */
function friendlyMongooseError(err, fallback) {
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    const label = { email: 'email address', cnic: 'CNIC', id: 'id' }[field] || field;
    return `That ${label} is already in use.`;
  }
  if (err && err.name === 'ValidationError') {
    const first = Object.values(err.errors)[0];
    return first ? first.message : fallback;
  }
  console.error(fallback, err);
  return fallback;
}

module.exports = router;
