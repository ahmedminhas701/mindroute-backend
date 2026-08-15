const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }, // e.g. 'Biology'
  isCore: { type: Boolean, default: false }, // core subjects can't be removed by admin
});

module.exports = mongoose.model('Subject', subjectSchema);