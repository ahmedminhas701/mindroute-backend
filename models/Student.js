const mongoose = require('mongoose');

const attendanceRowSchema = new mongoose.Schema({
  subject: String, total: Number, attended: Number, missed: Number,
}, { _id: false });

const quizScoreSchema = new mongoose.Schema({
  id: String, topic: String, subject: String, topicId: String,
  score: Number, total: Number, date: String, feedback: String,
  isAIRetry: Boolean, courseId: Number, attemptNum: Number,
}, { _id: false });

const assignmentSchema = new mongoose.Schema({
  id: String, topicId: String, title: String, course: String, courseId: Number,
  dueDate: String, submitted: Boolean, submittedOn: String,
  marks: Number, totalMarks: Number, grade: String, feedback: String,
  approved: Boolean, manualGrade: Boolean, answerText: String, fileUrl: String,
  fileName: String,
}, { _id: false });

const feeSchema = new mongoose.Schema({
  label: String, amount: Number, dueDate: String, status: String,
}, { _id: false });

const studentSchema = new mongoose.Schema({
  id: { type: String, unique: true },          // keep your existing 'S001' style ids
  name: String, rollNo: String, batch: String, entryTest: String,
  email: { type: String, unique: true }, phone: String, city: String, joinDate: String,
  enrolledCourseIds: [Number], attendance: Number,
  feeStatus: String, totalFee: Number, paidAmount: Number, nextDue: String,
  attendanceDetail: [attendanceRowSchema],
  quizScores: [quizScoreSchema],
  assignments: [assignmentSchema],
  fees: [feeSchema],
  topicProgress: {
    type: Map,
    of: Boolean,
    default: {},
  },
  lastTopic: {
    type: Map,
    of: String,   // courseId (as string) -> topicId
    default: {},
  },
});


module.exports = mongoose.model('Student', studentSchema);