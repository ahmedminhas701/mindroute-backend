const mongoose = require('mongoose');

const teacherSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: String,
  email: { type: String, unique: true },
  phone: String,
  subjects: [String],   // e.g. ['Biology', 'Chemistry'] — was singular `subject: String`
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  courseIds: [Number],
  joinDate: String,
});

module.exports = mongoose.model('Teacher', teacherSchema);