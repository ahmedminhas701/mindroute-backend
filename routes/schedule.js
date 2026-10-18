const express = require('express');
const router = express.Router();

const TeacherSchedule = require('../models/TeacherSchedule');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const Course = require('../models/Course');
const { protect, restrictTo } = require('../middleware/auth');
const V = require('../utils/validate');

const { notifyCourseStudents } = require('../utils/notify');

router.use(protect);

// ── What was wrong with this file ────────────────────────────────────────────
//
// POST was `TeacherSchedule.create(req.body)` - the entire request body, straight
// into the database. Three consequences:
//
//   1. No validation at all. A class could be saved with day: 'Funday',
//      time: 'whenever', duration: -5, and it would persist happily.
//   2. `subject` was whatever the client sent. The client sent the COURSE TITLE
//      when it couldn't match the course, so schedule rows ended up with
//      subject: 'Cell Biology Complete' - a string matching no Subject, which is
//      the same silent-mismatch failure the subject dropdowns exist to prevent.
//   3. `teacherId` came from the client, or was simply absent. Combined with PUT
//      and DELETE having no ownership check, ANY teacher could rewrite or delete
//      ANY other teacher's timetable by id. That is the authorization hole; the
//      rest is data hygiene.
//
// The teacher is now derived from the authenticated session, never from the body.

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WRITABLE = ['day', 'time', 'type', 'room', 'duration', 'courseId'];

/** The Teacher record for the caller, or null (admins have none). */
async function callerTeacher(req) {
  if (req.user.role !== 'teacher') return null;
  return Teacher.findOne({ email: req.user.email }).lean();
}

/**
 * Build a clean, fully-derived schedule row from a request body.
 *
 * `subject` and `course` are read off the Course record, never off the body -
 * that's what keeps schedule.subject a real subject name instead of whatever
 * text happened to be in the dropdown.
 */
async function buildRow(req, res, existing) {
  const body = V.pick(req.body, WRITABLE);
  const errors = {};
  const out = {};

  const day = V.normalizeEnum(body.day, { label: 'Day', values: DAYS });
  if (!day.ok) errors.day = day.error; else out.day = day.value;

  // HH:MM, 24-hour. `<input type="time">` always produces this, but a direct
  // API call needn't, and a bad time sorts wrongly and renders as garbage.
  const time = String(body.time || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    errors.time = 'Enter a time as HH:MM (24-hour).';
  } else {
    out.time = time;
  }

  const type = V.normalizeEnum(body.type, { label: 'Class type', values: ['physical', 'online'] });
  if (!type.ok) errors.type = type.error; else out.type = type.value;

  const duration = V.toInt(body.duration, { label: 'Duration', min: 15, max: 480 });
  if (!duration.ok) errors.duration = duration.error; else out.duration = duration.value;

  const room = V.normalizeText(body.room, { label: 'Room', max: 120 });
  if (!room.ok) errors.room = room.error;
  else out.room = room.value || (out.type === 'online' ? 'Online' : 'TBA');

  // The course decides both the subject and the teacher who may own this row.
  const courseId = V.toInt(body.courseId, { label: 'Course', min: 1 });
  let course = null;
  if (!courseId.ok) {
    errors.courseId = 'Pick a course.';
  } else {
    course = await Course.findOne({ id: courseId.value }).lean();
    if (!course) errors.courseId = 'That course no longer exists.';
  }

  if (course) {
    out.courseId = course.id;
    out.course   = course.title;     // denormalised for display
    out.subject  = course.subject;   // derived, never client-supplied
  }

  // A teacher may only schedule classes for their own courses. Admins may
  // schedule for anyone, so the row's teacher comes from the course.
  const me = await callerTeacher(req);
  if (course) {
    if (me) {
      const ownsCourse = course.teacher === me.id || (me.courseIds || []).includes(course.id);
      if (!ownsCourse) {
        res.status(403).json({
          message: `"${esc(course.title)}" isn't one of your courses.`,
          errors: { courseId: 'You can only schedule your own courses.' },
        });
        return null;
      }
      out.teacherId = me.id;
    } else {
      out.teacherId = course.teacher || (existing && existing.teacherId) || '';
    }
  }

  if (Object.keys(errors).length) {
    res.status(400).json({ message: V.firstError(errors) || 'Please correct the highlighted fields.', errors });
    return null;
  }

  // Two classes can't start at the same time on the same day for one teacher.
  // Double-booking was previously accepted and only showed up as two overlapping
  // cards in the timetable with no indication which was real.
  const clash = await TeacherSchedule.findOne({
    ...(existing ? { _id: { $ne: existing._id } } : {}),
    teacherId: out.teacherId,
    day: out.day,
    time: out.time,
  }).lean();
  if (clash) {
    res.status(409).json({
      message: `You already have ${clash.course || clash.subject} at ${out.time} on ${out.day}.`,
      errors: { time: 'You already have a class at this time.' },
    });
    return null;
  }

  return out;
}

// GET /api/schedule - students see only classes of courses they are enrolled in,
// teachers only their own, admins everything.
router.get('/', async (req, res) => {
  try {
    const filter = {};
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    if (req.query.day && days.includes(req.query.day)) filter.day = req.query.day;

    if (req.user.role === 'student') {
      const me = await Student.findOne({ email: req.user.email }, { enrolledCourseIds: 1 }).lean();
      filter.courseId = { $in: (me && me.enrolledCourseIds) || [] };
    } else if (req.user.role === 'teacher') {
      const me = await Teacher.findOne({ email: req.user.email }, { id: 1 }).lean();
      filter.teacherId = me ? me.id : '__none__';
    } else if (req.query.teacherId) {
      filter.teacherId = String(req.query.teacherId);
    }

    const rows = await TeacherSchedule.find(filter).sort({ day: 1, time: 1 }).lean();
    res.json(rows);
  } catch (err) {
    console.error('GET /schedule failed:', err);
    res.status(500).json({ message: 'Failed to load the schedule.' });
  }
});

// GET /api/schedule/:id
router.get('/:id', async (req, res) => {
  try {
    const row = await TeacherSchedule.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ message: 'Class not found.' });
    res.json(row);
  } catch (err) {
    res.status(400).json({ message: 'Invalid class id.' });
  }
});

// POST /api/schedule
router.post('/', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const clean = await buildRow(req, res, null);
    if (!clean) return;                       // response already sent
    const row = await TeacherSchedule.create(clean);
    await notifyCourseStudents(row.courseId, { type: 'schedule', title: 'Class scheduled', body: `${row.course}: ${row.day} at ${row.time} (${row.type}, ${row.duration} min).` });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST /schedule failed:', err);
    res.status(400).json({ message: 'Failed to create the class.' });
  }
});

// PUT /api/schedule/:id
router.put('/:id', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const existing = await TeacherSchedule.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Class not found.' });

    // Ownership check on the row being edited, separate from the check on the
    // course being moved TO. Without this, a teacher could PUT any row id.
    const me = await callerTeacher(req);
    if (me && existing.teacherId && existing.teacherId !== me.id) {
      return res.status(403).json({ message: "That class belongs to another teacher's timetable." });
    }

    const clean = await buildRow(req, res, existing);
    if (!clean) return;
    Object.assign(existing, clean);
    await existing.save();
    await notifyCourseStudents(existing.courseId, { type: 'schedule', title: 'Class updated', body: `${existing.course}: now ${existing.day} at ${existing.time} (${existing.type}, ${existing.duration} min).` });
    
    res.json(existing);
  } catch (err) {
    console.error('PUT /schedule/:id failed:', err);
    res.status(400).json({ message: 'Failed to update the class.' });
  }
});

// DELETE /api/schedule/:id
router.delete('/:id', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const row = await TeacherSchedule.findById(req.params.id);
    if (!row) return res.status(404).json({ message: 'Class not found.' });

    const me = await callerTeacher(req);
    if (me && row.teacherId && row.teacherId !== me.id) {
      return res.status(403).json({ message: "That class belongs to another teacher's timetable." });
    }

    await row.deleteOne();
    await notifyCourseStudents(row.courseId, { type: 'schedule', title: 'Class cancelled', body: `${row.course}: the ${row.day} ${row.time} class has been removed.` });
    res.json({ message: 'Class removed.' });
  } catch (err) {
    console.error('DELETE /schedule/:id failed:', err);
    res.status(400).json({ message: 'Failed to remove the class.' });
  }
});

module.exports = router;
