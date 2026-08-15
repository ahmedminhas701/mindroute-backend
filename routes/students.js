const express = require('express');
const router = express.Router();

const Student = require('../models/Student');
const User = require('../models/User');
const createUserAccount = require('../utils/createUserAccount');
const { protect, restrictTo } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(protect);

// ── Admin / Teacher listing & search ────────────────────────────────────
// GET /api/students?search=&batch=&feeStatus=
// Mirrors renderAdminStudents() filters (app.js §20).
router.get('/', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const { search, batch, feeStatus } = req.query;
    const filter = {};
    if (batch && batch !== 'all') filter.batch = batch;
    if (feeStatus && feeStatus !== 'all') filter.feeStatus = feeStatus;
    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [{ name: re }, { rollNo: re }, { email: re }];
    }
    const students = await Student.find(filter).sort({ name: 1 });
    res.json(students);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch students.', error: err.message });
  }
});

// GET /api/students/me — replaces getActiveStudent() (app.js §5)
router.get('/me', restrictTo('student'), async (req, res) => {
  const student = await Student.findOne({ email: req.user.email });
  if (!student) return res.status(404).json({ message: 'Student record not found.' });
  res.json(student);
});

// GET /api/students/:id
router.get('/:id', restrictTo('admin', 'teacher'), async (req, res) => {
  const student = await Student.findOne({ id: req.params.id });
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  res.json(student);
});

// POST /api/students — mirrors saveAdminStudent() (new student branch),
// PLUS creates the matching User login account. If the User creation
// fails (e.g. duplicate email), the just-created Student is rolled back
// so we never end up with a profile that has no way to log in.
// body may include an optional `password`; if omitted, a random temp
// password is generated and returned once in the response.
router.post('/', restrictTo('admin'), async (req, res) => {
  const { password, ...studentFields } = req.body;
  let student;
  try {
    const count = await Student.countDocuments();
    const id = 'S' + String(count + 1).padStart(3, '0');
    student = await Student.create({
      id,
      ...studentFields,
      enrolledCourseIds: [],
      attendanceDetail: [],
      quizScores: [],
      assignments: [],
      fees: [],
      nextDue: '—',
      joinDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to create student.', error: err.message });
  }

  try {
    const { tempPassword } = await createUserAccount({
      name: student.name, email: student.email, role: 'student', password,
    });
    res.status(201).json({ student, tempPassword });
  } catch (err) {
    await Student.deleteOne({ id: student.id }); // rollback
    res.status(400).json({ message: 'Student profile created but login account failed — rolled back.', error: err.message });
  }
});

// PUT /api/students/:id — mirrors saveAdminStudent() (edit branch)
router.put('/:id', restrictTo('admin'), async (req, res) => {
  const student = await Student.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  res.json(student);
});

// DELETE /api/students/:id — mirrors deleteStudent(), also removes the
// matching User login so no orphaned account is left behind.
// NOTE: still does not cascade-clean batch.studentIds — see
// TECHNICAL_REFERENCE.md §11.5.
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  const student = await Student.findOneAndDelete({ id: req.params.id });
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  await User.deleteOne({ email: student.email });
  res.json({ message: 'Student removed.' });
});

// ── Checkbox "done" progress (mr_progress in app.js §10) ────────────────
// PATCH /api/students/:id/progress/:topicId  { done: true|false }
router.patch('/:id/progress/:topicId', async (req, res) => {
  const student = await Student.findOne({ id: req.params.id });
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  if (req.user.role === 'student' && req.user.email !== student.email) {
    return res.status(403).json({ message: 'Not your record.' });
  }
  if (!student.topicProgress) student.topicProgress = new Map();
  student.topicProgress.set(req.params.topicId, !!req.body.done);
  await student.save();
  res.json({ topicId: req.params.topicId, done: !!req.body.done });
});

// ── Assignment submission (student) — mirrors submitAssignment() ────────
// PATCH /api/students/:id/assignments/:assignmentId/submit
// multipart/form-data: field "file" (optional) + field "text" (optional).
// Mirrors app.js's submission form, which required at least one of the two.
router.patch('/:id/assignments/:assignmentId/submit', restrictTo('student'), upload.single('file'), async (req, res) => {
  const student = await Student.findOne({ id: req.params.id });
  if (!student || student.email !== req.user.email) {
    return res.status(403).json({ message: 'Not your record.' });
  }
  // NOTE: assignments are plain subdocs identified by our own string `id`
  // field ('a1'), not Mongoose's auto _id — always look up with .find().
  const assign = student.assignments.find(a => a.id === req.params.assignmentId);
  if (!assign) return res.status(404).json({ message: 'Assignment not found.' });

  const hasText = req.body.text && req.body.text.trim().length > 0;
  const hasFile = !!req.file;
  if (!hasText && !hasFile) {
    return res.status(400).json({ message: 'Provide an answer or attach a file before submitting.' });
  }

  assign.submitted = true;
  assign.submittedOn = new Date().toISOString().split('T')[0];
  assign.approved = false;
  assign.grade = null;
  assign.marks = null;
  if (hasText) assign.answerText = req.body.text.trim();
  if (hasFile) {
    assign.fileUrl = `/uploads/${req.file.filename}`;
    assign.fileName = req.file.originalname;
  }
  await student.save();
  res.json(assign);
});

// ── Assignment grading (teacher) — mirrors submitGrade() (app.js §19) ───
// PATCH /api/students/:id/assignments/:assignmentId/grade  { marks, totalMarks, grade, feedback }
router.patch('/:id/assignments/:assignmentId/grade', restrictTo('teacher', 'admin'), async (req, res) => {
  const { marks, totalMarks, grade, feedback } = req.body;
  if (typeof marks !== 'number' || typeof totalMarks !== 'number' || totalMarks <= 0 || marks > totalMarks) {
    return res.status(400).json({ message: 'Invalid marks.' });
  }
  const student = await Student.findOne({ id: req.params.id });
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  const assign = student.assignments.find(a => a.id === req.params.assignmentId);
  if (!assign) return res.status(404).json({ message: 'Assignment not found.' });

  assign.marks = marks;
  assign.totalMarks = totalMarks;
  assign.grade = grade;
  assign.feedback = feedback || '';
  await student.save();
  res.json(assign);
});

// ── Approve grade — mirrors approveGrade(), also triggers attendance ────
// PATCH /api/students/:id/assignments/:assignmentId/approve
router.patch('/:id/assignments/:assignmentId/approve', restrictTo('teacher', 'admin'), async (req, res) => {
  const student = await Student.findOne({ id: req.params.id });
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  const assign = student.assignments.find(a => a.id === req.params.assignmentId);
  if (!assign) return res.status(404).json({ message: 'Assignment not found.' });

  assign.approved = true;
  // Port autoUpdateAttendance() here if/when topic-completion attendance
  // logic moves server-side; left as a no-op for now to keep this route small.
  await student.save();
  res.json(assign);
});

// ── Quiz scores ───────────────────────────────────────────────────────
// POST /api/students/:id/quiz-scores — in-page topic quiz submit (submitQuiz())
router.post('/:id/quiz-scores', restrictTo('student'), async (req, res) => {
  const student = await Student.findOne({ id: req.params.id });
  if (!student || student.email !== req.user.email) {
    return res.status(403).json({ message: 'Not your record.' });
  }
  const { topic, subject, topicId, score, total } = req.body;
  const existing = student.quizScores.find(q => q.topicId === topicId);
  const entry = {
    id: existing ? existing.id : 'qs' + Date.now(),
    topic, subject, topicId, score, total,
    date: new Date().toISOString().split('T')[0],
    feedback: '',
  };
  if (existing) Object.assign(existing, entry);
  else student.quizScores.push(entry);
  await student.save();
  res.json(entry);
});

// POST /api/students/:id/quiz-scores/ai-retry — mirrors submitRetryQuiz() (app.js §23)
router.post('/:id/quiz-scores/ai-retry', restrictTo('student'), async (req, res) => {
  const student = await Student.findOne({ id: req.params.id });
  if (!student || student.email !== req.user.email) {
    return res.status(403).json({ message: 'Not your record.' });
  }
  const { subject, courseId, score, total, attemptNum } = req.body;
  const entry = {
    id: 'ai_' + Date.now(),
    topic: `AI Retry — ${subject}`,
    subject,
    topicId: null,
    score, total,
    date: new Date().toISOString().split('T')[0],
    feedback: `AI-generated quiz, attempt ${attemptNum}`,
    isAIRetry: true,
    courseId,
    attemptNum,
  };
  student.quizScores.push(entry);
  await student.save();
  res.json(entry);
});

// PATCH /api/students/:id/quiz-scores/:itemId/grade — teacher manually edits a quiz score
router.patch('/:id/quiz-scores/:itemId/grade', restrictTo('teacher', 'admin'), async (req, res) => {
  const { score, feedback } = req.body;
  const student = await Student.findOne({ id: req.params.id });
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  const item = student.quizScores.find(q => q.id === req.params.itemId);
  if (!item) return res.status(404).json({ message: 'Quiz score not found.' });
  if (typeof score === 'number') item.score = score;
  if (feedback !== undefined) item.feedback = feedback;
  await student.save();
  res.json(item);
});

// PATCH /api/students/:id/last-topic  { courseId, topicId }
router.patch('/:id/last-topic', async (req, res) => {
  const student = await Student.findOne({ id: req.params.id });
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  if (req.user.role === 'student' && req.user.email !== student.email) {
    return res.status(403).json({ message: 'Not your record.' });
  }
  if (!student.lastTopic) student.lastTopic = new Map();
  student.lastTopic.set(String(req.body.courseId), req.body.topicId);
  await student.save();
  res.json({ courseId: req.body.courseId, topicId: req.body.topicId });
});



module.exports = router;
