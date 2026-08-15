const mongoose = require('mongoose');

const teacherScheduleSchema = new mongoose.Schema({
  teacherId: { type: String, required: false },  // → Teacher.id; optional for now, see note above
  day: String,       // 'Monday'
  time: String,       // '09:00'
  subject: String,
  course: String,      // course title string, not an id — matches current app.js shape
  type: { type: String, enum: ['physical', 'online'] },
  room: String,
  duration: Number,    // minutes
});

module.exports = mongoose.model('TeacherSchedule', teacherScheduleSchema);