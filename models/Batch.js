const mongoose = require('mongoose');

const batchSchema = new mongoose.Schema({
  id: { type: String, unique: true },        // 'B001' style
  name: String,
  entryTest: String,                          // display name, e.g. 'MDCAT'
  entryTestId: String,                        // → EntryTest.id, e.g. 'mdcat'
  startDate: String,
  status: { type: String, enum: ['upcoming', 'active', 'completed'], default: 'upcoming' },
  studentIds: [String],                       // → Student.id
  // subject name -> teacher.id, e.g. { Biology: 'T001', Physics: 'T002' }
  subjectTeachers: { type: Map, of: String, default: {} },
});

module.exports = mongoose.model('Batch', batchSchema);