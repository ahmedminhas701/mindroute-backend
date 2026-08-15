const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  role: { type: String, enum: ['student', 'teacher', 'admin'], required: true },
  name: String,
  password: {
  type: String,
  required: true,
  select: false,
  },
});

module.exports = mongoose.model('User', userSchema);