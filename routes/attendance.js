const express = require('express');
const router = express.Router();

const AttendanceRecord = require('../models/AttendanceRecord');
const Course = require('../models/Course');
const Teacher = require('../models/Teacher');
const Batch = require('../models/Batch');
const Student = require('../models/Student');
const { protect, restrictTo } = require('../middleware/auth');
const V = require('../utils/validate');
const { recomputeStudentAttendance } = require('../utils/recomputeAttendance');

router.use(protect);

// Same ownership shape as mayEditCurriculum() in routes/courses.js — a
// teacher may only take attendance for a course they actually teach.
async function mayTakeAttendance(req, res, course) {
  if (req.user.role === 'admin') return true;
  const teacher = await Teacher.findOne({ email: req.user.email });
  if (!teacher) { res.status(403).json({ message: 'No teacher profile is linked to your account.' }); return false; }
  if (course.teacher === teacher.id) return true;
  if ((teacher.courseIds || []).includes(course.id)) return true;
  const batches = await Batch.find({});
  for (const b of batches) {
    if (!b.subjectTeachers) continue;
    const map = b.subjectTeachers instanceof Map ? b.subjectTeachers : new Map(Object.entries(b.subjectTeachers));
    let owns = false;
    map.forEach((tid, subject) => { if (tid === teacher.id && subject === course.subject) owns = true; });
    if (owns) return true;
  }
  res.status(403).json({ message: 'You can only take attendance for courses you teach.' });
  return false;
}

// GET /api/attendance/roster/:courseId — everyone enrolled, for the "take
// attendance" checklist.
router.get('/roster/:courseId', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const courseId = Number(req.params.courseId);
    const course = await Course.findOne({ id: courseId });
    if (!course) return res.status(404).json({ message: 'Course not found.' });
    if (!(await mayTakeAttendance(req, res, course))) return;

    const students = await Student.find({ enrolledCourseIds: courseId }, { id: 1, name: 1, rollNo: 1 }).sort({ name: 1 });
    res.json({ course: { id: course.id, title: course.title, subject: course.subject }, students });
  } catch (err) {
    console.error('GET /attendance/roster failed:', err);
    res.status(500).json({ message: 'Failed to load the roster.' });
  }
});

// GET /api/attendance/:courseId/:date — load an existing day's record, so
// "take attendance" for a date already marked opens pre-filled for correction.
router.get('/:courseId/:date', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const courseId = Number(req.params.courseId);
    const course = await Course.findOne({ id: courseId });
    if (!course) return res.status(404).json({ message: 'Course not found.' });
    if (!(await mayTakeAttendance(req, res, course))) return;
    const record = await AttendanceRecord.findOne({ courseId, date: req.params.date }).lean();
    res.json(record || null);
  } catch (err) {
    console.error('GET /attendance/:courseId/:date failed:', err);
    res.status(500).json({ message: 'Failed to load attendance.' });
  }
});

// POST /api/attendance  { courseId, date, entries: [{studentId, present}] }
router.post('/', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const courseId = Number(req.body.courseId);
    const course = await Course.findOne({ id: courseId });
    if (!course) return res.status(400).json({ message: 'That course does not exist.' });
    if (!(await mayTakeAttendance(req, res, course))) return;

    const dateR = V.normalizeDate(req.body.date, { label: 'Class date' });
    if (!dateR.ok) return res.status(400).json({ message: dateR.error });

    const roster = await Student.find({ enrolledCourseIds: courseId }, { id: 1 }).lean();
    const rosterIds = new Set(roster.map(s => s.id));

    const incoming = Array.isArray(req.body.entries) ? req.body.entries : [];
    if (!incoming.length) return res.status(400).json({ message: 'Mark at least one student.' });

    const entries = [];
    for (const e of incoming) {
      const studentId = String(e.studentId || '');
      if (!rosterIds.has(studentId)) {
        return res.status(400).json({ message: `${studentId} is not enrolled in this course.` });
      }
      entries.push({ studentId, present: !!e.present });
    }

    const teacher = req.user.role === 'teacher' ? await Teacher.findOne({ email: req.user.email }) : null;

    const record = await AttendanceRecord.findOneAndUpdate(
      { courseId: course.id, date: dateR.value },
      { courseId: course.id, subject: course.subject, date: dateR.value, teacherId: teacher ? teacher.id : null, entries },
      { upsert: true, new: true }
    );

    await recomputeStudentAttendance(entries.map(e => e.studentId));

    res.status(201).json({ message: 'Attendance saved.', record });
  } catch (err) {
    console.error('POST /attendance failed:', err);
    res.status(400).json({ message: 'Failed to save attendance.' });
  }
});

module.exports = router;