const express = require('express');
const router = express.Router();

const Teacher = require('../models/Teacher');
const Student = require('../models/Student');
const Batch = require('../models/Batch');
const Course = require('../models/Course');
const User = require('../models/User');
const createUserAccount = require('../utils/createUserAccount');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

// Server-side port of getTeacherCourseIds() (app.js §4 / TECHNICAL_REFERENCE §4).
// A teacher is linked to a course two ways: directly via teacher.courseIds,
// or indirectly via a batch's subjectTeachers map. This merges both.
async function resolveTeacherCourseIds(teacher) {
  const ids = new Set(teacher.courseIds || []);
  const batches = await Batch.find({});
  const courses = await Course.find({});
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

// GET /api/teachers
router.get('/', async (req, res) => {
  const { search } = req.query;
  const filter = search ? { $or: [{ name: new RegExp(search, 'i') }, { subject: new RegExp(search, 'i') }] } : {};
  const teachers = await Teacher.find(filter).sort({ name: 1 });
  res.json(teachers);
});

// GET /api/teachers/me — replaces getActiveTeacher() (app.js §4)
router.get('/me', restrictTo('teacher'), async (req, res) => {
  const teacher = await Teacher.findOne({ email: req.user.email });
  if (!teacher) return res.status(404).json({ message: 'Teacher record not found.' });
  res.json(teacher);
});

// GET /api/teachers/:id
router.get('/:id', restrictTo('admin', 'teacher'), async (req, res) => {
  const teacher = await Teacher.findOne({ id: req.params.id });
  if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
  res.json(teacher);
});

// GET /api/teachers/:id/courses — resolved course ids (direct + batch-derived)
router.get('/:id/courses', restrictTo('admin', 'teacher'), async (req, res) => {
  const teacher = await Teacher.findOne({ id: req.params.id });
  if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
  if (req.user.role === 'teacher' && req.user.email !== teacher.email) {
    return res.status(403).json({ message: 'Not your record.' });
  }
  const courseIds = await resolveTeacherCourseIds(teacher);
  const courses = await Course.find({ id: { $in: courseIds } });
  res.json(courses);
});

// GET /api/teachers/:id/students — students enrolled in any of this teacher's courses
router.get('/:id/students', restrictTo('admin', 'teacher'), async (req, res) => {
  const teacher = await Teacher.findOne({ id: req.params.id });
  if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
  if (req.user.role === 'teacher' && req.user.email !== teacher.email) {
    return res.status(403).json({ message: 'Not your record.' });
  }
  const courseIds = await resolveTeacherCourseIds(teacher);
  const students = await Student.find({ enrolledCourseIds: { $in: courseIds } });
  res.json(students);
});

// GET /api/teachers/:id/pending-grading — submitted-but-not-approved assignments
// across the teacher's courses; mirrors the widget in renderTeacherDashboard().
router.get('/:id/pending-grading', restrictTo('admin', 'teacher'), async (req, res) => {
  const teacher = await Teacher.findOne({ id: req.params.id });
  if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
  const courseIds = await resolveTeacherCourseIds(teacher);
  const students = await Student.find({ 'assignments.courseId': { $in: courseIds } });

  const pending = [];
  students.forEach(s => {
    s.assignments
      .filter(a => courseIds.includes(a.courseId) && a.submitted && !a.approved)
      .forEach(a => pending.push({ ...a.toObject(), studentId: s.id, studentName: s.name }));
  });
  res.json(pending);
});

// POST /api/teachers — creates the Teacher profile PLUS the matching
// User login account, same pattern as POST /api/students. Rolls back
// the profile if the login account creation fails.
// body may include an optional `password`; if omitted, a random temp
// password is generated and returned once in the response.
router.post('/', restrictTo('admin'), async (req, res) => {
  const { password, ...teacherFields } = req.body;
  let teacher;
  try {
    const count = await Teacher.countDocuments();
    const id = 'T' + String(count + 1).padStart(3, '0');
    teacher = await Teacher.create({
      id, ...teacherFields, courseIds: [],
      joinDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to create teacher.', error: err.message });
  }

  try {
    const { tempPassword } = await createUserAccount({
      name: teacher.name, email: teacher.email, role: 'teacher', password,
    });
    res.status(201).json({ teacher, tempPassword });
  } catch (err) {
    await Teacher.deleteOne({ id: teacher.id }); // rollback
    res.status(400).json({ message: 'Teacher profile created but login account failed — rolled back.', error: err.message });
  }
});

// PUT /api/teachers/:id
router.put('/:id', restrictTo('admin'), async (req, res) => {
  const teacher = await Teacher.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
  if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
  res.json(teacher);
});

// DELETE /api/teachers/:id — also removes the matching User login.
// NOTE: does not cascade-clean batch.subjectTeachers entries pointing at
// this id — see TECHNICAL_REFERENCE.md §11.5.
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  const teacher = await Teacher.findOneAndDelete({ id: req.params.id });
  if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
  await User.deleteOne({ email: teacher.email });
  res.json({ message: 'Teacher removed.' });
});

module.exports = router;
