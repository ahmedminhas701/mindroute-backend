const AttendanceRecord = require('../models/AttendanceRecord');
const Student = require('../models/Student');

/**
 * Rebuilds a student's attendanceDetail/attendance fields from scratch, from
 * every AttendanceRecord they appear in. Recomputing rather than incrementing
 * means correcting a mis-marked day (resubmit the same course+date) can never
 * leave a stale +1 behind from the original mistake.
 */
async function recomputeStudentAttendance(studentIds) {
  for (const studentId of studentIds) {
    const records = await AttendanceRecord.find({ 'entries.studentId': studentId }).lean();
    const bySubject = new Map();
    records.forEach(r => {
      const entry = r.entries.find(e => e.studentId === studentId);
      if (!entry) return;
      const row = bySubject.get(r.subject) || { total: 0, attended: 0 };
      row.total += 1;
      if (entry.present) row.attended += 1;
      bySubject.set(r.subject, row);
    });
    const attendanceDetail = [...bySubject.entries()].map(([subject, v]) => ({
      subject, total: v.total, attended: v.attended, missed: v.total - v.attended,
    }));
    const totalAll = attendanceDetail.reduce((a, b) => a + b.total, 0);
    const attendedAll = attendanceDetail.reduce((a, b) => a + b.attended, 0);
    const overall = totalAll ? Math.round((attendedAll / totalAll) * 100) : 0;

    await Student.updateOne({ id: studentId }, { $set: { attendanceDetail, attendance: overall } });
  }
}

module.exports = { recomputeStudentAttendance };