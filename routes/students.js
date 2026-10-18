const express = require('express');
const router = express.Router();

const fs = require('fs');
const Teacher = require('../models/Teacher');

const Student = require('../models/Student');
const User = require('../models/User');
const Batch = require('../models/Batch');
const createUserAccount = require('../utils/createUserAccount');
const { protect, restrictTo } = require('../middleware/auth');
const upload = require('../middleware/upload');
const V = require('../utils/validate');
const { nextId } = require('../utils/nextId');
const { assignStudentToBatch } = require('../utils/courseSync');
const Course = require('../models/Course');
const { notifyStudents, notifyTeacher } = require('../utils/notify');

router.use(protect);


const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_AI_ATTEMPTS = 3;
const MAX_QUIZ_ATTEMPTS = 2;
const GRADE_LETTERS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D', 'F'];

async function callerTeacher(req) {
  return req.user.role === 'teacher' ? Teacher.findOne({ email: req.user.email }, { id: 1 }).lean() : null;
}

/** A teacher may only act on courses assigned to them; admins on any. Sends 403 and returns false otherwise. */
async function mayGradeCourse(req, res, courseId) {
  if (req.user.role === 'admin') return true;
  const me = await callerTeacher(req);
  const course = courseId != null ? await Course.findOne({ id: Number(courseId) }, { teacher: 1 }).lean() : null;
  if (me && course && course.teacher === me.id) return true;
  res.status(403).json({ message: 'You can only grade students in courses you teach.' });
  return false;
}

/** Finds a topic inside the courses this student is enrolled in. */
async function findTopicForStudent(student, topicId) {
  const courses = await Course.find({ id: { $in: student.enrolledCourseIds || [] } }).lean();
  for (const course of courses) {
    for (const week of course.weeks || []) {
      for (const topic of week.topics || []) {
        if (topic.id === topicId) return { course, week, topic };
      }
    }
  }
  return null;
}

async function courseIdForTopic(topicId) {
  if (!topicId) return null;
  const c = await Course.findOne({ 'weeks.topics.id': topicId }, { id: 1 }).lean();
  return c ? c.id : null;
}

// Teachers never need these. Fees, ID numbers, addresses and guardian details stay admin-only.
const TEACHER_HIDDEN_FIELDS = '-cnic -address -dob -gender -guardianName -guardianPhone -previousSchool -totalFee -paidAmount -feeStatus -nextDue -fees';

// Fields a client is allowed to set on a student. Everything else in req.body is
// dropped before it reaches Mongoose, so nobody can POST
// { attendance: 100, feeStatus: 'Paid', enrolledCourseIds: [1,2,3] } and grant
// themselves anything.
const STUDENT_WRITABLE = Object.keys(V.STUDENT_RULES).filter(k => k !== 'attendance');

// Server-owned fields, excluded on purpose:
//   id, joinDate                      -> assigned by the server
//   enrolledCourseIds                 -> owned by batch/course enrolment logic
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

/**
 * Validates values.batch against real batches and derives entryTest from it.
 * Returns false after sending a 400.
 */
async function resolveBatchOr400(res, values) {
  if (values.batch === undefined) return true;           // not being changed
  if (!values.batch) { values.entryTest = ''; return true; }
  const b = await Batch.findOne({ name: values.batch }, { entryTest: 1 }).lean();
  if (!b) {
    res.status(400).json({
      message: `Batch "${values.batch}" does not exist.`,
      errors: { batch: 'Pick a batch from the list.' },
    });
    return false;
  }
  values.entryTest = b.entryTest;   // always derived from the batch, never trusted from the form
  return true;
}

// ── Admin / Teacher listing & search ────────────────────────────────────
// GET /api/students?search=&batch=&feeStatus=
router.get('/', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const { search, batch, feeStatus } = req.query;
    const filter = {};
    if (batch && batch !== 'all') filter.batch = String(batch);
    if (feeStatus && feeStatus !== 'all' && V.FEE_STATUSES.includes(feeStatus) && req.user.role === 'admin') {
      filter.feeStatus = feeStatus;
    }
    if (search) {
      const re = new RegExp(V.escapeRegex(String(search).slice(0, 80)), 'i');
      filter.$or = [{ name: re }, { rollNo: re }, { email: re }, { phone: re }];
    }
    let q;
    if (req.user.role === 'teacher') {
      const me = await callerTeacher(req);
      const mine = me ? await Course.find({ teacher: me.id }, { id: 1 }).lean() : [];
      filter.enrolledCourseIds = { $in: mine.map(c => c.id) };
      q = Student.find(filter).select(TEACHER_HIDDEN_FIELDS).sort({ name: 1 });
    } else {
      q = Student.find(filter).sort({ name: 1 });
    }
    res.json(await q);
  } catch (err) {
    console.error('GET /students failed:', err);
    res.status(500).json({ message: 'Failed to fetch students.' });
  }
});

// GET /api/students/me - marks, grades and feedback stay hidden until the teacher approves them
router.get('/me', restrictTo('student'), async (req, res) => {
  try {
    const student = await Student.findOne({ email: req.user.email });
    if (!student) return res.status(404).json({ message: 'Student record not found.' });
    const obj = student.toJSON({ flattenMaps: true, virtuals: true });
    obj.assignments = (obj.assignments || []).map(a => a.approved ? a : { ...a, marks: null, grade: null, feedback: '' });
    res.json(obj);
  } catch (err) {
    console.error('GET /students/me failed:', err);
    res.status(500).json({ message: 'Failed to load your record.' });
  }
});

// GET /api/students/options - dropdown data for the Add/Edit Student modal,
// built from the same arrays the server validates against.
router.get('/options', restrictTo('admin', 'teacher'), (req, res) => {
  res.json({
    genders: V.GENDERS,
    feeStatuses: V.FEE_STATUSES,
  });
});

// GET /api/students/:id
router.get('/:id', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    let q = Student.findOne({ id: req.params.id });
    if (req.user.role === 'teacher') q = q.select(TEACHER_HIDDEN_FIELDS);
    const student = await q;
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    if (req.user.role === 'teacher') {
      const me = await callerTeacher(req);
      const mine = me ? await Course.find({ teacher: me.id }, { id: 1 }).lean() : [];
      const ids = new Set(mine.map(c => c.id));
      if (!(student.enrolledCourseIds || []).some(id => ids.has(id))) {
        return res.status(403).json({ message: 'That student is not in any of your courses.' });
      }
    }
    res.json(student);
  } catch (err) {
    console.error('GET /students/:id failed:', err);
    res.status(500).json({ message: 'Failed to load student.' });
  }
});

// POST /api/students - creates the profile, the matching User login, and (if a
// batch was chosen) the batch membership + course enrolment. If any later step
// fails, everything created so far is rolled back.
router.post('/', restrictTo('admin'), async (req, res) => {
  const values = cleanStudentBody(res, req.body);
  if (!values) return;

  const password = typeof req.body.password === 'string' ? req.body.password : undefined;
  if (password !== undefined && password.length < 8) {
    return res.status(400).json({
      message: 'Password must be at least 8 characters (or leave it blank to generate one).',
      errors: { password: 'Password must be at least 6 characters.' },
    });
  }

  if (!(await resolveBatchOr400(res, values))) return;

  // Check both collections up front so the admin gets a readable message
  // instead of a raw E11000.
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
      joinDate: new Date().toISOString().slice(0, 10),   // ISO: sortable, locale-independent
    });
  } catch (err) {
    return res.status(400).json({ message: friendlyMongooseError(err, 'Failed to create student.') });
  }

  try {
    const { tempPassword } = await createUserAccount({
      name: student.name, email: student.email, role: 'student', password,
    });

    try {
      // Adds them to Batch.studentIds and enrols them in the batch's courses.
      if (values.batch) await assignStudentToBatch(student.id, values.batch);
    } catch (batchErr) {
      console.error('Student batch assignment failed, rolling back:', batchErr);
      await Student.deleteOne({ id: student.id }).catch(() => {});
      await User.deleteOne({ email: student.email }).catch(() => {});
      await Batch.updateMany({ studentIds: student.id }, { $pull: { studentIds: student.id } }).catch(() => {});
      return res.status(500).json({ message: 'Could not enrol the student in that batch, so the student was not saved. Please try again.' });
    }

    const fresh = await Student.findOne({ id: student.id });
    res.status(201).json({ student: fresh, tempPassword });
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
  if (!(await resolveBatchOr400(res, values))) return;

  try {
    const existing = await Student.findOne({ id: req.params.id });
    if (!existing) return res.status(404).json({ message: 'Student not found.' });
    // Once instalments exist, they decide the totals. Ignore any manual fee edits.
    if ((existing.fees || []).length) { delete values.totalFee; delete values.paidAmount; delete values.feeStatus; }

    // Cross-field rules need the merged record, not just the changed fields.
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
    // .save() runs the full validator set; findOneAndUpdate does not.
    await existing.save();

    // Keep the login account in step with the profile.
    if (values.email && values.email !== oldEmail) {
      await User.updateOne({ email: oldEmail }, { $set: { email: values.email } });
    }
    if (values.name) {
      await User.updateOne({ email: existing.email }, { $set: { name: existing.name } });
    }

    // Batch changes are applied through the shared helper so the batch roster,
    // the old batch's courses and the new batch's courses all stay consistent.
    // It is idempotent, so calling it on every edit that includes `batch` also
    // repairs any record whose label and roster had drifted apart.
    if (values.batch !== undefined) {
      try {
        await assignStudentToBatch(existing.id, values.batch);
      } catch (batchErr) {
        console.error('Student batch re-assignment failed:', batchErr);
        return res.status(500).json({
          message: 'The student details were saved, but the batch change could not be completed. ' +
                   'Open Admin > Batches and save the batch to re-sync enrolment.',
        });
      }
    }

    res.json(await Student.findOne({ id: existing.id }));
  } catch (err) {
    res.status(400).json({ message: friendlyMongooseError(err, 'Failed to update student.') });
  }
});

// DELETE /api/students/:id - removes the profile, the login, and the student's
// membership of any batch.
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  try {
    const student = await Student.findOneAndDelete({ id: req.params.id });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    await User.deleteOne({ email: student.email });
    await Batch.updateMany({ studentIds: student.id }, { $pull: { studentIds: student.id } });

    res.json({ message: 'Student removed.' });
  } catch (err) {
    console.error('DELETE /students/:id failed:', err);
    res.status(500).json({ message: 'Failed to remove student.' });
  }
});

// POST /api/teachers/:id/reset-password — admin issues a new temporary password.
router.post('/:id/reset-password', restrictTo('admin'), async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ id: req.params.id }, { email: 1 }).lean();
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
    const { tempPassword } = await createUserAccount.resetPassword(teacher.email);
    res.json({ email: teacher.email, tempPassword });
  } catch (err) {
    console.error('POST /teachers/:id/reset-password failed:', err);
    res.status(400).json({ message: 'Could not reset the password. The login account may be missing.' });
  }
});

// PUT /api/students/:id/fees  { fees: [{ label, amount, dueDate, paid }] }
router.put('/:id/fees', restrictTo('admin'), async (req, res) => {
  try {
    const student = await Student.findOne({ id: req.params.id });
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const rows = Array.isArray(req.body.fees) ? req.body.fees : null;
    if (!rows || rows.length > 24) return res.status(400).json({ message: 'Send between 0 and 24 instalments.' });

    const today = new Date().toISOString().slice(0, 10);
    const fees = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const label  = V.normalizeText(r.label, { label: `Instalment ${i + 1} name`, required: true, min: 2, max: 60 });
      if (!label.ok) return res.status(400).json({ message: label.error });
      const amount = V.toInt(r.amount, { label: `Instalment ${i + 1} amount`, min: 1, max: 10000000 });
      if (!amount.ok) return res.status(400).json({ message: amount.error });
      const due    = V.normalizeDate(r.dueDate, { label: `Instalment ${i + 1} due date` });
      if (!due.ok) return res.status(400).json({ message: due.error });
      fees.push({
        label: label.value, amount: amount.value, dueDate: due.value,
        status: r.paid ? 'Paid' : (due.value < today ? 'Overdue' : 'Pending'),
      });
    }

    student.fees = fees;
    if (fees.length) {
      const total  = fees.reduce((a, f) => a + f.amount, 0);
      const paid   = fees.filter(f => f.status === 'Paid').reduce((a, f) => a + f.amount, 0);
      const unpaid = fees.filter(f => f.status !== 'Paid').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      student.totalFee = total;
      student.paidAmount = paid;
      student.feeStatus = paid >= total ? 'Paid' : paid > 0 ? 'Partial' : (unpaid.some(f => f.status === 'Overdue') ? 'Overdue' : 'Pending');
      student.nextDue = unpaid.length ? unpaid[0].dueDate : '';
    }
    await student.save();
    await notifyStudents([student.id], { type: 'change', title: 'Fee schedule updated', body: 'Your fee instalments were updated. Open Fee Details to see them.' });
    res.json(student);
  } catch (err) {
    console.error('PUT /students/:id/fees failed:', err);
    res.status(500).json({ message: 'Failed to save the fee instalments.' });
  }
});

// ── Checkbox "done" progress ────────────────────────────────────────────
router.patch('/:id/progress/:topicId', restrictTo('student'), async (req, res) => {
  try {
    const student = await Student.findOne({ id: req.params.id });
    if (!student || student.email !== req.user.email) return res.status(403).json({ message: 'Not your record.' });
    const topicId = String(req.params.topicId);
    if (!SAFE_ID.test(topicId) || !(await findTopicForStudent(student, topicId))) {
      return res.status(404).json({ message: 'That topic is not part of a course you are enrolled in.' });
    }
    if (!student.topicProgress) student.topicProgress = new Map();
    student.topicProgress.set(topicId, !!req.body.done);
    await student.save();
    res.json({ topicId, done: !!req.body.done });
  } catch (err) {
    console.error('PATCH progress failed:', err);
    res.status(500).json({ message: 'Failed to save progress.' });
  }
});

// ── Assignment submission (student) ─────────────────────────────────────
// The record is created on first submission, with id 'a_' + topicId.
router.patch('/:id/assignments/:assignmentId/submit', restrictTo('student'), upload.single('file'), async (req, res) => {
  const discardUpload = () => { if (req.file) fs.unlink(req.file.path, () => {}); };
  try {
    const student = await Student.findOne({ id: req.params.id });
    if (!student || student.email !== req.user.email) { discardUpload(); return res.status(403).json({ message: 'Not your record.' }); }

    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (!text && !req.file) return res.status(400).json({ message: 'Provide an answer or attach a file before submitting.' });
    if (text.length > 20000) { discardUpload(); return res.status(400).json({ message: 'Your answer is too long (max 20,000 characters).' }); }

    const assignmentId = String(req.params.assignmentId);
    let assign = student.assignments.find(a => a.id === assignmentId);

    if (!assign) {
      const topicId = assignmentId.startsWith('a_') ? assignmentId.slice(2) : '';
      const src = SAFE_ID.test(topicId) ? await findTopicForStudent(student, topicId) : null;
      const content = src && (src.topic.contents || []).find(c => c.type === 'assign');
      if (!content) { discardUpload(); return res.status(404).json({ message: 'Assignment not found.' }); }
      student.assignments.push({
        id: 'a_' + topicId, topicId,
        title: src.topic.title, course: src.course.title, courseId: src.course.id,
        dueDate: src.topic.dueDate || '',
        totalMarks: Number(content.totalMarks) > 0 ? Number(content.totalMarks) : 10,
        submitted: false, approved: false, marks: null,
      });
      assign = student.assignments[student.assignments.length - 1];
    }

    if (assign.approved) {
      discardUpload();
      return res.status(409).json({ message: 'This assignment has already been graded and approved, so it can no longer be changed.' });
    }

    assign.submitted = true;
    assign.submittedOn = new Date().toISOString().slice(0, 10);
    assign.approved = false;
    assign.grade = null;
    assign.marks = null;
    if (text) assign.answerText = text;
    if (req.file) {
      assign.fileUrl = `/uploads/${req.file.filename}`;
      assign.fileName = req.file.originalname;
    }
    await student.save();

    const subCourse = await Course.findOne({ id: assign.courseId }, { teacher: 1 }).lean();
    if (subCourse && subCourse.teacher) {
      await notifyTeacher(subCourse.teacher, { type: 'upload', title: 'New submission', body: `${student.name} submitted "${assign.title}".` });
    }
    res.json(assign);
  } catch (err) {
    discardUpload();
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
    if (marksR.value > totalR.value) {
      return res.status(400).json({ message: `Marks (${marksR.value}) cannot be more than the total (${totalR.value}).` });
    }
    const gradeIn = typeof req.body.grade === 'string' ? req.body.grade.trim() : '';
    if (gradeIn && !GRADE_LETTERS.includes(gradeIn)) {
      return res.status(400).json({ message: `Grade must be one of: ${GRADE_LETTERS.join(', ')}.` });
    }

    const student = await Student.findOne({ id: req.params.id });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    const assign = student.assignments.find(a => a.id === req.params.assignmentId);
    if (!assign) return res.status(404).json({ message: 'Assignment not found.' });
    if (!(await mayGradeCourse(req, res, assign.courseId))) return;
    if (!assign.submitted) return res.status(400).json({ message: 'This assignment has not been submitted yet, so it cannot be graded.' });

    assign.marks = marksR.value;
    assign.totalMarks = totalR.value;
    assign.grade = gradeIn;
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
    if (!(await mayGradeCourse(req, res, assign.courseId))) return;
    if (assign.marks === null || assign.marks === undefined) {
      return res.status(400).json({ message: 'Enter marks before approving this grade.' });
    }
    assign.approved = true;
    await student.save();
    await notifyStudents([student.id], { type: 'change', title: 'Assignment graded', body: `"${assign.title}": ${assign.marks}/${assign.totalMarks}${assign.grade ? ' (' + assign.grade + ')' : ''}.` });
    res.json(assign);
  } catch (err) {
    console.error('PATCH approve failed:', err);
    res.status(500).json({ message: 'Failed to approve the grade.' });
  }
});

// ── Quiz scores: GRADED ON THE SERVER ───────────────────────────────────
// The browser sends only its answers. Scores can no longer be typed in by the student,
// and the correct answers are never sent to a student before they submit.
router.post('/:id/quiz-scores', restrictTo('student'), async (req, res) => {
  try {
    const student = await Student.findOne({ id: req.params.id });
    if (!student || student.email !== req.user.email) return res.status(403).json({ message: 'Not your record.' });

    const topicId = String(req.body.topicId || '');
    const found = SAFE_ID.test(topicId) ? await findTopicForStudent(student, topicId) : null;
    if (!found) return res.status(404).json({ message: 'That quiz is not part of a course you are enrolled in.' });

    const quiz = (found.topic.contents || []).find(c => c.type === 'quiz' && Array.isArray(c.questions) && c.questions.length);
    if (!quiz) return res.status(400).json({ message: 'This quiz has no questions yet.' });

    const existing = student.quizScores.find(q => q.topicId === topicId);
    const used = existing ? (existing.attemptNum || 1) : 0;
    if (used >= MAX_QUIZ_ATTEMPTS) {
      return res.status(409).json({ message: `You have already used all ${MAX_QUIZ_ATTEMPTS} attempts for this quiz.` });
    }

    const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
    if (answers.length > quiz.questions.length) return res.status(400).json({ message: 'Too many answers for this quiz.' });

    let score = 0;
    const correctAnswers = quiz.questions.map((q, i) => {
      const correct = Number(q.correct);
      if (Number.isInteger(answers[i]) && answers[i] === correct) score++;
      return correct;
    });

    const entry = {
      id: existing ? existing.id : 'qs' + Date.now() + Math.random().toString(36).slice(2, 6),
      topic: found.topic.title,
      subject: found.course.subject,
      topicId,
      courseId: found.course.id,
      score: existing ? Math.max(existing.score, score) : score,   // best attempt counts
      total: quiz.questions.length,
      attemptNum: used + 1,
      date: new Date().toISOString().slice(0, 10),
      feedback: existing ? existing.feedback : '',
    };
    if (existing) Object.assign(existing, entry); else student.quizScores.push(entry);
    await student.save();
    res.json({ entry, attemptScore: score, correctAnswers, attemptsLeft: MAX_QUIZ_ATTEMPTS - (used + 1) });
  } catch (err) {
    console.error('POST quiz-scores failed:', err);
    res.status(500).json({ message: 'Failed to save your quiz score.' });
  }
});

// AI practice quizzes are practice only: they are not counted in official averages.
router.post('/:id/quiz-scores/ai-retry', restrictTo('student'), async (req, res) => {
  try {
    const student = await Student.findOne({ id: req.params.id });
    if (!student || student.email !== req.user.email) return res.status(403).json({ message: 'Not your record.' });

    const courseId = Number(req.body.courseId);
    if (!Number.isInteger(courseId) || !(student.enrolledCourseIds || []).includes(courseId)) {
      return res.status(403).json({ message: 'You are not enrolled in that course.' });
    }
    const course = await Course.findOne({ id: courseId }, { subject: 1 }).lean();
    if (!course) return res.status(404).json({ message: 'Course not found.' });

    const used = student.quizScores.filter(q => q.isAIRetry && q.courseId === courseId).length;
    if (used >= MAX_AI_ATTEMPTS) return res.status(409).json({ message: 'No practice attempts remaining for this course.' });

    const totalR = V.toInt(req.body.total, { label: 'Total', min: 1, max: 20 });
    if (!totalR.ok) return res.status(400).json({ message: totalR.error });
    const scoreR = V.toInt(req.body.score, { label: 'Score', min: 0, max: totalR.value });
    if (!scoreR.ok) return res.status(400).json({ message: scoreR.error });

    const entry = {
      id: 'ai_' + Date.now() + Math.random().toString(36).slice(2, 6),
      topic: `AI Practice - ${esc(course.subject)}`,
      subject: course.subject,
      topicId: null,
      courseId,
      score: scoreR.value,
      total: totalR.value,
      date: new Date().toISOString().slice(0, 10),
      feedback: `AI-generated practice quiz, attempt ${used + 1}`,
      isAIRetry: true,
      attemptNum: used + 1,
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
    if (item.isAIRetry) return res.status(400).json({ message: 'Practice quizzes are not graded manually.' });

    const owner = item.courseId != null ? item.courseId : await courseIdForTopic(item.topicId);
    if (!(await mayGradeCourse(req, res, owner))) return;

    if (req.body.score !== undefined && req.body.score !== '') {
      const scoreR = V.toInt(req.body.score, { label: 'Score', min: 0, max: item.total || 1000 });
      if (!scoreR.ok) return res.status(400).json({ message: scoreR.error });
      item.score = scoreR.value;
    }
    if (req.body.feedback !== undefined) item.feedback = String(req.body.feedback).slice(0, 2000);
    await student.save();
    res.json(item);
  } catch (err) {
    console.error('PATCH quiz grade failed:', err);
    res.status(500).json({ message: 'Failed to update the quiz score.' });
  }
});

// PATCH /api/students/:id/last-topic  { courseId, topicId }
router.patch('/:id/last-topic', restrictTo('student'), async (req, res) => {
  try {
    const student = await Student.findOne({ id: req.params.id });
    if (!student || student.email !== req.user.email) return res.status(403).json({ message: 'Not your record.' });
    const courseId = Number(req.body.courseId);
    const topicId = String(req.body.topicId || '');
    if (!Number.isInteger(courseId) || !(student.enrolledCourseIds || []).includes(courseId) || !SAFE_ID.test(topicId)) {
      return res.status(400).json({ message: 'Invalid course or topic.' });
    }
    if (!student.lastTopic) student.lastTopic = new Map();
    student.lastTopic.set(String(courseId), topicId);
    await student.save();
    res.json({ courseId, topicId });
  } catch (err) {
    console.error('PATCH last-topic failed:', err);
    res.status(500).json({ message: 'Failed to save your place.' });
  }
});

/**
 * Turn a Mongoose/Mongo error into something a human can act on, without
 * leaking collection or index names to the browser.
 */
function friendlyMongooseError(err, fallback) {
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    const label = { email: 'email address', rollNo: 'roll number', id: 'id' }[field] || field;
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