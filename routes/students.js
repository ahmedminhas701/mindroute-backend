const express = require('express');
const router = express.Router();

const Student = require('../models/Student');
const User = require('../models/User');
const createUserAccount = require('../utils/createUserAccount');
const { protect, restrictTo } = require('../middleware/auth');
const upload = require('../middleware/upload');
const V = require('../utils/validate');
const { nextId } = require('../utils/nextId');

router.use(protect);

// Fields a client is allowed to set on a student. Everything else in req.body is
// dropped before it reaches Mongoose.
//
// WHY A WHITELIST. Both write routes used to pass req.body straight through:
//
//     Student.create({ id, ...req.body })
//     Student.findOneAndUpdate({ id }, req.body)
//
// which means any caller could set ANY field. The PATCH routes below are
// reachable by a logged-in student, and while PUT is admin-only, the pattern is
// one route-permission mistake away from letting a student POST
// { attendance: 100, feeStatus: 'Paid', enrolledCourseIds: [1,2,3] } and grant
// themselves free enrolment. Whitelisting makes that structurally impossible
// rather than relying on every route being correct forever.
const STUDENT_WRITABLE = Object.keys(V.STUDENT_RULES);

// Derived/server-owned fields, listed here so it's obvious they're excluded on
// purpose and not by omission:
//   id, joinDate                      -> assigned by the server
//   enrolledCourseIds                 -> owned by batch enrolment logic
//   attendanceDetail, quizScores,
//   assignments, fees, topicProgress,
//   lastTopic, nextDue                -> mutated only by their own routes

/** Validate + normalise a student payload. Returns null after sending a 400. */
function cleanStudentBody(res, body, { partial = false } = {}) {
  const input = V.pick(body, STUDENT_WRITABLE);
  const { ok, values, errors } = V.validate(input, V.STUDENT_RULES, { partial });
  const cross = V.crossCheckStudent(values);
  const all = Object.assign({}, errors, cross);

  if (!ok || Object.keys(cross).length) {
    res.status(400).json({
      message: V.firstError(all),
      errors: all,           // so the modal can highlight each field
    });
    return null;
  }
  return values;
}

// ── Admin / Teacher listing & search ────────────────────────────────────
// GET /api/students?search=&batch=&feeStatus=
router.get('/', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const { search, batch, feeStatus } = req.query;
    const filter = {};
    if (batch && batch !== 'all') filter.batch = String(batch);
    // Only accept a feeStatus we actually use, so a junk value returns
    // everything-that-matches-nothing rather than being injected into the query.
    if (feeStatus && feeStatus !== 'all' && V.FEE_STATUSES.includes(feeStatus)) {
      filter.feeStatus = feeStatus;
    }
    if (search) {
      // escapeRegex is not optional here. `new RegExp(search, 'i')` on raw user
      // input is a denial-of-service: a search for "(a+)+$" makes the regex
      // engine backtrack exponentially and pins the single Node thread, taking
      // the whole API down for every user. It also means a search for "a.c"
      // matched "abc", which was quietly wrong.
      const re = new RegExp(V.escapeRegex(String(search).slice(0, 80)), 'i');
      filter.$or = [{ name: re }, { rollNo: re }, { email: re }, { phone: re }];
    }
    const students = await Student.find(filter).sort({ name: 1 });
    res.json(students);
  } catch (err) {
    console.error('GET /students failed:', err);
    res.status(500).json({ message: 'Failed to fetch students.' });
  }
});

// GET /api/students/me
router.get('/me', restrictTo('student'), async (req, res) => {
  try {
    const student = await Student.findOne({ email: req.user.email });
    if (!student) return res.status(404).json({ message: 'Student record not found.' });
    res.json(student);
  } catch (err) {
    console.error('GET /students/me failed:', err);
    res.status(500).json({ message: 'Failed to load your record.' });
  }
});

// GET /api/students/options — everything the Add/Edit Student modal needs to
// build its dropdowns, in one request. Keeps the <select> option lists and the
// server's enum checks from drifting apart: the form is literally built from the
// same arrays the server validates against.
router.get('/options', restrictTo('admin', 'teacher'), (req, res) => {
  res.json({
    genders: V.GENDERS,
    feeStatuses: V.FEE_STATUSES,
  });
});

// GET /api/students/:id
router.get('/:id', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const student = await Student.findOne({ id: req.params.id });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    res.json(student);
  } catch (err) {
    console.error('GET /students/:id failed:', err);
    res.status(500).json({ message: 'Failed to load student.' });
  }
});

// POST /api/students — creates the profile AND the matching User login account.
// If the User creation fails (e.g. duplicate email) the Student is deleted again
// so we never leave a profile that has no way to log in.
router.post('/', restrictTo('admin'), async (req, res) => {
  const values = cleanStudentBody(res, req.body);
  if (!values) return;

  const password = typeof req.body.password === 'string' ? req.body.password : undefined;
  if (password !== undefined && password.length < 6) {
    return res.status(400).json({
      message: 'Password must be at least 6 characters (or leave it blank to generate one).',
      errors: { password: 'Password must be at least 6 characters.' },
    });
  }

  // Check both collections up front. Without this the admin gets a raw E11000
  // ("E11000 duplicate key error collection: ... index: email_1") which means
  // nothing to them, and — worse — a duplicate User email used to leave a
  // Student behind on the older code path.
  const [dupEmail, dupRoll, dupUser] = await Promise.all([
    Student.findOne({ email: values.email }, { id: 1 }).lean(),
    Student.findOne({ rollNo: values.rollNo }, { id: 1 }).lean(),
    User.findOne({ email: values.email }, { _id: 1 }).lean(),
  ]);
  if (dupEmail || dupUser) {
    return res.status(409).json({
      message: `That email is already registered${dupEmail ? ' to student ' + dupEmail.id : ''}.`,
      errors: { email: 'This email is already in use.' },
    });
  }
  if (dupRoll) {
    return res.status(409).json({
      message: `Roll number ${values.rollNo} is already used by student ${dupRoll.id}.`,
      errors: { rollNo: 'This roll number is already in use.' },
    });
  }

  let student;
  try {
    student = await Student.create({
      ...values,
      id: await nextId('student', 'S'),
      enrolledCourseIds: [],
      attendanceDetail: [],
      quizScores: [],
      assignments: [],
      fees: [],
      nextDue: '',
      // ISO, not toLocaleDateString(). The old code stored "Aug 30, 2026",
      // which cannot be sorted, compared or parsed reliably, and differs by
      // server locale.
      joinDate: new Date().toISOString().slice(0, 10),
    });
  } catch (err) {
    return res.status(400).json({ message: friendlyMongooseError(err, 'Failed to create student.') });
  }

  try {
    const { tempPassword } = await createUserAccount({
      name: student.name, email: student.email, role: 'student', password,
    });
    res.status(201).json({ student, tempPassword });
  } catch (err) {
    await Student.deleteOne({ id: student.id }); // rollback
    console.error('Student login account creation failed:', err);
    res.status(400).json({ message: 'Could not create the login account, so the student was not saved. Please try again.' });
  }
});

// PUT /api/students/:id
router.put('/:id', restrictTo('admin'), async (req, res) => {
  // partial:true so the caller can send just the fields they changed. Anything
  // they DO send is still fully validated.
  const values = cleanStudentBody(res, req.body, { partial: true });
  if (!values) return;

  try {
    const existing = await Student.findOne({ id: req.params.id });
    if (!existing) return res.status(404).json({ message: 'Student not found.' });

    // Cross-field rules need the merged record, not just the changed fields:
    // sending paidAmount alone must still be checked against the stored
    // totalFee, otherwise a two-step edit walks straight past the rule.
    const merged = Object.assign({
      totalFee: existing.totalFee,
      paidAmount: existing.paidAmount,
      feeStatus: existing.feeStatus,
      phone: existing.phone,
      guardianPhone: existing.guardianPhone,
    }, values);
    const cross = V.crossCheckStudent(merged);
    if (Object.keys(cross).length) {
      return res.status(400).json({ message: V.firstError(cross), errors: cross });
    }

    if (values.email && values.email !== existing.email) {
      const [dup, dupUser] = await Promise.all([
        Student.findOne({ email: values.email, id: { $ne: existing.id } }, { id: 1 }).lean(),
        User.findOne({ email: values.email }, { _id: 1 }).lean(),
      ]);
      if (dup || dupUser) {
        return res.status(409).json({ message: 'That email is already registered.', errors: { email: 'This email is already in use.' } });
      }
    }
    if (values.rollNo && values.rollNo !== existing.rollNo) {
      const dup = await Student.findOne({ rollNo: values.rollNo, id: { $ne: existing.id } }, { id: 1 }).lean();
      if (dup) {
        return res.status(409).json({ message: `Roll number ${values.rollNo} is already used by ${dup.id}.`, errors: { rollNo: 'This roll number is already in use.' } });
      }
    }

    const oldEmail = existing.email;
    Object.assign(existing, values);
    // .save() runs the full validator set; findOneAndUpdate without
    // runValidators (which is what this route used to do) runs NONE of them, so
    // every schema rule added in models/Student.js would have been bypassed on
    // every edit.
    await existing.save();

    // Keep the login account in step. Changing a student's email in the admin
    // panel used to leave their User row on the old address, so they could no
    // longer log in and nothing said why.
    if (values.email && values.email !== oldEmail) {
      await User.updateOne({ email: oldEmail }, { $set: { email: values.email } });
    }
    if (values.name) {
      await User.updateOne({ email: existing.email }, { $set: { name: existing.name } });
    }

    res.json(existing);
  } catch (err) {
    res.status(400).json({ message: friendlyMongooseError(err, 'Failed to update student.') });
  }
});

// DELETE /api/students/:id — removes the profile, the login, and the student's
// membership of any batch.
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  try {
    const student = await Student.findOneAndDelete({ id: req.params.id });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    await User.deleteOne({ email: student.email });

    // Cascade-clean batch membership. Previously the student's id stayed in
    // batch.studentIds forever, so every batch page rendered a phantom member
    // and the batch's student count was permanently wrong.
    const Batch = require('../models/Batch');
    await Batch.updateMany({ studentIds: student.id }, { $pull: { studentIds: student.id } });

    res.json({ message: 'Student removed.' });
  } catch (err) {
    console.error('DELETE /students/:id failed:', err);
    res.status(500).json({ message: 'Failed to remove student.' });
  }
});

// ── Checkbox "done" progress ────────────────────────────────────────────
// PATCH /api/students/:id/progress/:topicId  { done: true|false }
router.patch('/:id/progress/:topicId', async (req, res) => {
  try {
    const student = await Student.findOne({ id: req.params.id });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    if (req.user.role === 'student' && req.user.email !== student.email) {
      return res.status(403).json({ message: 'Not your record.' });
    }
    // Map keys go into MongoDB field names, so a key of '$set' or '__proto__'
    // is a real problem. isSafeKey rejects both.
    if (!V.isSafeKey(req.params.topicId)) {
      return res.status(400).json({ message: 'Invalid topic id.' });
    }
    if (!student.topicProgress) student.topicProgress = new Map();
    student.topicProgress.set(req.params.topicId, !!req.body.done);
    await student.save();
    res.json({ topicId: req.params.topicId, done: !!req.body.done });
  } catch (err) {
    console.error('PATCH progress failed:', err);
    res.status(500).json({ message: 'Failed to save progress.' });
  }
});

// ── Assignment submission (student) ─────────────────────────────────────
router.patch('/:id/assignments/:assignmentId/submit', restrictTo('student'), upload.single('file'), async (req, res) => {
  try {
    const student = await Student.findOne({ id: req.params.id });
    if (!student || student.email !== req.user.email) {
      return res.status(403).json({ message: 'Not your record.' });
    }
    // Assignments are plain subdocs keyed by our own string `id` ('a1'), not
    // Mongoose's _id — always look them up with .find().
    const assign = student.assignments.find(a => a.id === req.params.assignmentId);
    if (!assign) return res.status(404).json({ message: 'Assignment not found.' });

    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    const hasFile = !!req.file;
    if (!text && !hasFile) {
      return res.status(400).json({ message: 'Provide an answer or attach a file before submitting.' });
    }
    if (text.length > 20000) {
      return res.status(400).json({ message: 'Your answer is too long (max 20,000 characters).' });
    }
    // Re-submitting an already-graded assignment would silently wipe the
    // teacher's marks and feedback below. Block it instead.
    if (assign.approved) {
      return res.status(409).json({ message: 'This assignment has already been graded and approved, so it can no longer be changed.' });
    }

    assign.submitted = true;
    assign.submittedOn = new Date().toISOString().slice(0, 10);
    assign.approved = false;
    assign.grade = null;
    assign.marks = null;
    if (text) assign.answerText = text;
    if (hasFile) {
      assign.fileUrl = `/uploads/${req.file.filename}`;
      assign.fileName = req.file.originalname;
    }
    await student.save();
    res.json(assign);
  } catch (err) {
    console.error('PATCH submit failed:', err);
    res.status(500).json({ message: 'Failed to submit assignment.' });
  }
});

// ── Assignment grading (teacher) ────────────────────────────────────────
router.patch('/:id/assignments/:assignmentId/grade', restrictTo('teacher', 'admin'), async (req, res) => {
  try {
    const marksR = V.toInt(req.body.marks, { label: 'Marks', min: 0, max: 100000 });
    if (!marksR.ok) return res.status(400).json({ message: marksR.error });
    const totalR = V.toInt(req.body.totalMarks, { label: 'Total marks', min: 1, max: 100000 });
    if (!totalR.ok) return res.status(400).json({ message: totalR.error });
    // The old check tested `marks > totalMarks` but never `marks < 0`, so
    // -50 out of 100 was accepted and then rendered as a negative percentage.
    // toInt's min:0 closes that; this closes the other side.
    if (marksR.value > totalR.value) {
      return res.status(400).json({ message: `Marks (${marksR.value}) cannot be more than the total (${totalR.value}).` });
    }

    const student = await Student.findOne({ id: req.params.id });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    const assign = student.assignments.find(a => a.id === req.params.assignmentId);
    if (!assign) return res.status(404).json({ message: 'Assignment not found.' });
    if (!assign.submitted) {
      return res.status(400).json({ message: 'This assignment has not been submitted yet, so it cannot be graded.' });
    }

    assign.marks = marksR.value;
    assign.totalMarks = totalR.value;
    assign.grade = typeof req.body.grade === 'string' ? req.body.grade.trim().slice(0, 4) : '';
    assign.feedback = typeof req.body.feedback === 'string' ? req.body.feedback.trim().slice(0, 2000) : '';
    assign.manualGrade = true;
    await student.save();
    res.json(assign);
  } catch (err) {
    console.error('PATCH grade failed:', err);
    res.status(500).json({ message: 'Failed to save the grade.' });
  }
});

// ── Approve grade ───────────────────────────────────────────────────────
router.patch('/:id/assignments/:assignmentId/approve', restrictTo('teacher', 'admin'), async (req, res) => {
  try {
    const student = await Student.findOne({ id: req.params.id });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    const assign = student.assignments.find(a => a.id === req.params.assignmentId);
    if (!assign) return res.status(404).json({ message: 'Assignment not found.' });
    // Approving something with no marks publishes a blank grade to the student.
    if (assign.marks === null || assign.marks === undefined) {
      return res.status(400).json({ message: 'Enter marks before approving this grade.' });
    }
    assign.approved = true;
    await student.save();
    res.json(assign);
  } catch (err) {
    console.error('PATCH approve failed:', err);
    res.status(500).json({ message: 'Failed to approve the grade.' });
  }
});

// ── Quiz scores ─────────────────────────────────────────────────────────
router.post('/:id/quiz-scores', restrictTo('student'), async (req, res) => {
  try {
    const student = await Student.findOne({ id: req.params.id });
    if (!student || student.email !== req.user.email) {
      return res.status(403).json({ message: 'Not your record.' });
    }
    // score/total came straight from the request body before this. A student
    // could POST { score: 999, total: 10 } from the console and it was stored
    // and displayed as their result.
    const totalR = V.toInt(req.body.total, { label: 'Total', min: 1, max: 1000 });
    if (!totalR.ok) return res.status(400).json({ message: totalR.error });
    const scoreR = V.toInt(req.body.score, { label: 'Score', min: 0, max: totalR.value });
    if (!scoreR.ok) return res.status(400).json({ message: scoreR.error });

    const { topic, subject, topicId } = req.body;
    const existing = student.quizScores.find(q => q.topicId === topicId);
    const entry = {
      id: existing ? existing.id : 'qs' + Date.now(),
      topic: String(topic || '').slice(0, 200),
      subject: String(subject || '').slice(0, 60),
      topicId,
      score: scoreR.value,
      total: totalR.value,
      date: new Date().toISOString().slice(0, 10),
      feedback: existing ? existing.feedback : '',
    };
    if (existing) Object.assign(existing, entry);
    else student.quizScores.push(entry);
    await student.save();
    res.json(entry);
  } catch (err) {
    console.error('POST quiz-scores failed:', err);
    res.status(500).json({ message: 'Failed to save your quiz score.' });
  }
});

router.post('/:id/quiz-scores/ai-retry', restrictTo('student'), async (req, res) => {
  try {
    const student = await Student.findOne({ id: req.params.id });
    if (!student || student.email !== req.user.email) {
      return res.status(403).json({ message: 'Not your record.' });
    }
    const totalR = V.toInt(req.body.total, { label: 'Total', min: 1, max: 1000 });
    if (!totalR.ok) return res.status(400).json({ message: totalR.error });
    const scoreR = V.toInt(req.body.score, { label: 'Score', min: 0, max: totalR.value });
    if (!scoreR.ok) return res.status(400).json({ message: scoreR.error });
    const attemptR = V.toInt(req.body.attemptNum, { label: 'Attempt number', min: 1, max: 50 });

    const { subject, courseId } = req.body;
    const entry = {
      id: 'ai_' + Date.now(),
      topic: `AI Retry — ${String(subject || '').slice(0, 60)}`,
      subject: String(subject || '').slice(0, 60),
      topicId: null,
      score: scoreR.value,
      total: totalR.value,
      date: new Date().toISOString().slice(0, 10),
      feedback: `AI-generated quiz, attempt ${attemptR.ok ? attemptR.value : 1}`,
      isAIRetry: true,
      courseId: Number(courseId) || null,
      attemptNum: attemptR.ok ? attemptR.value : 1,
    };
    student.quizScores.push(entry);
    await student.save();
    res.json(entry);
  } catch (err) {
    console.error('POST ai-retry failed:', err);
    res.status(500).json({ message: 'Failed to save your quiz score.' });
  }
});

router.patch('/:id/quiz-scores/:itemId/grade', restrictTo('teacher', 'admin'), async (req, res) => {
  try {
    const student = await Student.findOne({ id: req.params.id });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    const item = student.quizScores.find(q => q.id === req.params.itemId);
    if (!item) return res.status(404).json({ message: 'Quiz score not found.' });

    if (req.body.score !== undefined && req.body.score !== '') {
      const scoreR = V.toInt(req.body.score, { label: 'Score', min: 0, max: item.total || 1000 });
      if (!scoreR.ok) return res.status(400).json({ message: scoreR.error });
      item.score = scoreR.value;
    }
    if (req.body.feedback !== undefined) {
      item.feedback = String(req.body.feedback).slice(0, 2000);
    }
    await student.save();
    res.json(item);
  } catch (err) {
    console.error('PATCH quiz grade failed:', err);
    res.status(500).json({ message: 'Failed to update the quiz score.' });
  }
});

// PATCH /api/students/:id/last-topic  { courseId, topicId }
router.patch('/:id/last-topic', async (req, res) => {
  try {
    const student = await Student.findOne({ id: req.params.id });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    if (req.user.role === 'student' && req.user.email !== student.email) {
      return res.status(403).json({ message: 'Not your record.' });
    }
    const key = String(req.body.courseId);
    if (!V.isSafeKey(key)) return res.status(400).json({ message: 'Invalid course id.' });
    if (!student.lastTopic) student.lastTopic = new Map();
    student.lastTopic.set(key, String(req.body.topicId || ''));
    await student.save();
    res.json({ courseId: req.body.courseId, topicId: req.body.topicId });
  } catch (err) {
    console.error('PATCH last-topic failed:', err);
    res.status(500).json({ message: 'Failed to save your place.' });
  }
});

/**
 * Turn a Mongoose/Mongo error into something a human can act on.
 *
 * The old routes sent `error: err.message` to the browser, which surfaced
 * things like "E11000 duplicate key error collection: mindroute.students index:
 * email_1 dup key: ..." — meaningless to an admin, and it leaks the database
 * name, collection names and index names to anyone who can trigger it.
 */
function friendlyMongooseError(err, fallback) {
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    const label = { email: 'email address', rollNo: 'roll number', id: 'id' }[field] || field;
    return `That ${label} is already in use.`;
  }
  if (err && err.name === 'ValidationError') {
    // Mongoose messages here come from our own schema definitions, so they're
    // already written for a human.
    const first = Object.values(err.errors)[0];
    return first ? first.message : fallback;
  }
  console.error(fallback, err);
  return fallback;
}

module.exports = router;
