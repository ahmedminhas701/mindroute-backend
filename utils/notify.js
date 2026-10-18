const Notification = require('../models/Notification');
const User = require('../models/User');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');

async function notifyUsersByEmail(emails, { type = 'system', title, body = '' }) {
  try {
    const list = [...new Set((emails || []).filter(Boolean).map(e => String(e).toLowerCase().trim()))];
    if (!list.length || !title) return;
    const users = await User.find({ email: { $in: list } }, { _id: 1 }).lean();
    if (!users.length) return;
    await Notification.insertMany(users.map(u => ({
      userId: String(u._id),
      type,
      title: String(title).slice(0, 120),
      body: String(body).slice(0, 1000),
      read: false,
    })));
  } catch (err) {
    console.error('Notification failed (the action itself succeeded):', err.message);
  }
}

async function notifyStudents(studentIds, payload) {
  try {
    if (!studentIds || !studentIds.length) return;
    const students = await Student.find({ id: { $in: studentIds } }, { email: 1 }).lean();
    await notifyUsersByEmail(students.map(s => s.email), payload);
  } catch (err) { console.error('notifyStudents failed:', err.message); }
}

async function notifyCourseStudents(courseId, payload) {
  try {
    const students = await Student.find({ enrolledCourseIds: courseId }, { email: 1 }).lean();
    await notifyUsersByEmail(students.map(s => s.email), payload);
  } catch (err) { console.error('notifyCourseStudents failed:', err.message); }
}

async function notifyTeacher(teacherId, payload) {
  try {
    if (!teacherId) return;
    const t = await Teacher.findOne({ id: teacherId }, { email: 1 }).lean();
    if (t) await notifyUsersByEmail([t.email], payload);
  } catch (err) { console.error('notifyTeacher failed:', err.message); }
}

module.exports = { notifyUsersByEmail, notifyStudents, notifyCourseStudents, notifyTeacher };