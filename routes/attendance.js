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
const { notifyStudents } = require('../utils/notify');

router.use(protect);

// Same ownership shape as mayEditCurriculum() in routes/courses.js - a
// teacher may only take attendance for a course they actually teach.
async function mayTakeAttendance(req, res, course) {
  if (req.user.role === 'admin') return true;
  const teacher = await Teacher.findOne({ email: req.user.email });
  if (!teacher) { res.status(403).json({ message: 'No teacher profile is linked to your account.' }); return false; }
  if (course.teacher === teacher.id || course.teacher === teacher.name) return true;
  if ((teacher.courseIds || []).includes(course.id)) return true;
  const batches = await Batch.find({});
  for (const b of batches) {
    if (!b.subjectTeachers) continue;
    const map = b.subjectTeachers instanceof Map ? b.subjectTeachers : new Map(Object.entries(b.subjectTeachers));
    let owns = false;
    map.forEach((tid, subject) => { if ((tid === teacher.id || tid === teacher.name) && subject === course.subject) owns = true; });
    if (owns) return true;
  }
  res.status(403).json({ message: 'You can only take attendance for courses you teach.' });
  return false;
}

// GET /api/attendance/roster/:courseId - everyone enrolled, for the checklist
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

// GET /api/attendance/sheet/:courseId - full matrix sheet for batch/course
router.get('/sheet/:courseId', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const courseId = Number(req.params.courseId);
    const course = await Course.findOne({ id: courseId });
    if (!course) return res.status(404).json({ message: 'Course not found.' });
    if (!(await mayTakeAttendance(req, res, course))) return;

    const students = await Student.find(
      { enrolledCourseIds: courseId },
      { id: 1, name: 1, rollNo: 1, batch: 1 }
    ).sort({ name: 1 }).lean();

    const query = { courseId };
    if (req.query.startDate || req.query.endDate) {
      query.date = {};
      if (req.query.startDate) query.date.$gte = String(req.query.startDate);
      if (req.query.endDate) query.date.$lte = String(req.query.endDate);
    }

    const records = await AttendanceRecord.find(query).sort({ date: 1 }).lean();
    const dates = records.map(r => r.date);

    const matrix = {};
    const summary = {};

    students.forEach(s => {
      matrix[s.id] = {};
      summary[s.id] = { total: 0, attended: 0, late: 0, missed: 0, pct: 0 };
    });

    records.forEach(r => {
      (r.entries || []).forEach(e => {
        if (!matrix[e.studentId]) return;
        const status = e.status || (e.present ? 'present' : 'absent');
        matrix[e.studentId][r.date] = status;

        const sum = summary[e.studentId];
        sum.total += 1;
        if (status === 'present' || status === 'late') {
          sum.attended += 1;
          if (status === 'late') sum.late += 1;
        } else {
          sum.missed += 1;
        }
      });
    });

    students.forEach(s => {
      const sum = summary[s.id];
      sum.pct = sum.total ? Math.round((sum.attended / sum.total) * 100) : 0;
    });

    res.json({
      course: { id: course.id, title: course.title, subject: course.subject, batchId: course.batchId },
      students,
      dates,
      matrix,
      summary,
    });
  } catch (err) {
    console.error('GET /attendance/sheet failed:', err);
    res.status(500).json({ message: 'Failed to load attendance sheet.' });
  }
});

// GET /api/attendance/:courseId/:date - load an existing day's record
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

// POST /api/attendance  { courseId, date, entries: [{studentId, status, present}] }
router.post('/', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const courseId = Number(req.body.courseId);
    const course = await Course.findOne({ id: courseId });
    if (!course) return res.status(400).json({ message: 'That course does not exist.' });
    if (!(await mayTakeAttendance(req, res, course))) return;

    const dateR = V.normalizeDate(req.body.date, { label: 'Class date', mustBePast: true });
    if (!dateR.ok) return res.status(400).json({ message: dateR.error });

    const roster = await Student.find({ enrolledCourseIds: courseId }, { id: 1 }).lean();
    const rosterIds = new Set(roster.map(s => s.id));

    const incoming = Array.isArray(req.body.entries) ? req.body.entries : [];
    if (incoming.length > 500) return res.status(400).json({ message: 'Too many entries.' });
    if (!incoming.length) return res.status(400).json({ message: 'Mark at least one student.' });

    const entries = [];
    for (const e of incoming) {
      const studentId = String(e.studentId || '');
      if (!rosterIds.has(studentId)) {
        return res.status(400).json({ message: `${studentId} is not enrolled in this course.` });
      }
      const rawStatus = String(e.status || '').toLowerCase();
      const status = (rawStatus === 'present' || rawStatus === 'absent' || rawStatus === 'late')
        ? rawStatus
        : (e.present === false ? 'absent' : 'present');
      const present = status !== 'absent';
      entries.push({ studentId, status, present });
    }

    const teacher = req.user.role === 'teacher' ? await Teacher.findOne({ email: req.user.email }) : null;

    const before = await AttendanceRecord.findOne({ courseId: course.id, date: dateR.value }).lean();
    const record = await AttendanceRecord.findOneAndUpdate(
      { courseId: course.id, date: dateR.value },
      { courseId: course.id, subject: course.subject, date: dateR.value, teacherId: teacher ? teacher.id : null, entries },
      { upsert: true, new: true }
    );

    await recomputeStudentAttendance(entries.map(e => e.studentId));
    const wasAbsent = new Set(((before && before.entries) || []).filter(e => !e.present).map(e => e.studentId));
    const newlyAbsent = entries.filter(e => !e.present && !wasAbsent.has(e.studentId)).map(e => e.studentId);
    await notifyStudents(newlyAbsent, { type: 'change', title: 'Marked absent', body: `You were marked absent for ${course.title} on ${dateR.value}.` });

    res.status(201).json({ message: 'Attendance saved.', record });
  } catch (err) {
    console.error('POST /attendance failed:', err);
    res.status(400).json({ message: 'Failed to save attendance.' });
  }
});

// GET /api/attendance/my-course/:courseId - student's detailed lecture attendance log
router.get('/my-course/:courseId', restrictTo('student'), async (req, res) => {
  try {
    const courseId = Number(req.params.courseId);
    const student = await Student.findOne({ email: req.user.email }).lean();
    if (!student || !(student.enrolledCourseIds || []).includes(courseId)) {
      return res.status(403).json({ message: 'You are not enrolled in this course.' });
    }

    const course = await Course.findOne({ id: courseId }).lean();
    if (!course) return res.status(404).json({ message: 'Course not found.' });

    const records = await AttendanceRecord.find({ courseId }).sort({ date: 1 }).lean();
    const lectures = [];
    let attended = 0;
    let late = 0;
    let missed = 0;

    records.forEach((r, idx) => {
      const entry = (r.entries || []).find(e => e.studentId === student.id);
      const rawStatus = entry ? (entry.status || (entry.present ? 'present' : 'absent')) : 'absent';
      const status = rawStatus.toLowerCase();
      if (status === 'present' || status === 'late') {
        attended++;
        if (status === 'late') late++;
      } else {
        missed++;
      }
      lectures.push({
        lectureNum: idx + 1,
        date: r.date,
        status,
        present: status !== 'absent',
      });
    });

    const total = lectures.length;
    const percentage = total ? Math.round((attended / total) * 100) : 0;

    res.json({
      course: { id: course.id, title: course.title, subject: course.subject },
      total,
      attended,
      late,
      missed,
      percentage,
      isShortage: total > 0 && percentage < 75,
      lectures,
    });
  } catch (err) {
    console.error('GET /attendance/my-course/:courseId failed:', err);
    res.status(500).json({ message: 'Failed to load course attendance.' });
  }
});

module.exports = router;
