const mongoose = require('mongoose');

// ── One row = one weekly recurring class slot ────────────────────────────────
//
// `subject` and `course` are DENORMALISED copies of the parent course's fields,
// kept because the student dashboard and the teacher timetable both render them
// directly. They are written only by routes/schedule.js, which reads them off the
// Course record - never from the request body. Before that, the client sent
// `subject` itself and fell back to sending the course TITLE when it couldn't
// resolve the course, so rows existed whose "subject" matched no Subject at all.
//
// `courseId` is the actual link. It was missing entirely, which is why the code
// had to match on title strings.
const teacherScheduleSchema = new mongoose.Schema({
  teacherId: { type: String, required: false },  // → Teacher.id, set from the session
  courseId:  { type: Number, required: false },  // → Course.id
  day: {
    type: String,
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  },
  // 'HH:MM', 24-hour. Stored as a string so it sorts lexicographically, which is
  // the same as chronologically for zero-padded 24-hour times.
  time: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  subject: String,     // derived from Course.subject
  course: String,      // derived from Course.title, for display
  type: { type: String, enum: ['physical', 'online'] },
  room: String,
  duration: { type: Number, min: 15, max: 480 },   // minutes
}, { timestamps: true });

// A teacher can't be in two places at once.
teacherScheduleSchema.index({ teacherId: 1, day: 1, time: 1 });

module.exports = mongoose.model('TeacherSchedule', teacherScheduleSchema);
