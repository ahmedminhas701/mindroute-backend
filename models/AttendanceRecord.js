const mongoose = require('mongoose');

const attendanceEntrySchema = new mongoose.Schema({
  studentId: { type: String, required: true },
  present: { type: Boolean, default: false },
}, { _id: false });

const attendanceRecordSchema = new mongoose.Schema({
  courseId: { type: Number, required: true },
  subject: { type: String, required: true },   // denormalised from Course, for reporting
  date: {
    type: String,
    required: true,
    validate: { validator: v => /^\d{4}-\d{2}-\d{2}$/.test(v), message: 'Date must be YYYY-MM-DD.' },
  },
  teacherId: { type: String, default: null },
  entries: { type: [attendanceEntrySchema], default: [] },
}, { timestamps: true });

// One record per course per day. Resubmitting the same course+date CORRECTS
// that day rather than creating a duplicate — see routes/attendance.js's
// upsert. Student.attendance/attendanceDetail are fully recomputed from these
// records every time, never incrementally bumped, so a correction can never
// double-count or drift out of sync with reality.
attendanceRecordSchema.index({ courseId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);