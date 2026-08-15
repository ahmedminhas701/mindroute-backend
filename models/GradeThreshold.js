const mongoose = require('mongoose');

const thresholdRowSchema = new mongoose.Schema({
  min: Number,    // e.g. 90
  grade: String,  // e.g. 'A+'
}, { _id: false });

const gradeThresholdSchema = new mongoose.Schema({
  // singleton doc — always query/update the one row, e.g. findOneAndUpdate({}, ...)
  thresholds: {
    type: [thresholdRowSchema],
    default: [
      { min: 90, grade: 'A+' }, { min: 85, grade: 'A' }, { min: 80, grade: 'A-' },
      { min: 75, grade: 'B+' }, { min: 70, grade: 'B' }, { min: 65, grade: 'B-' },
      { min: 60, grade: 'C+' }, { min: 55, grade: 'C' }, { min: 50, grade: 'D' },
      { min: 0,  grade: 'F' },
    ],
  },
});

module.exports = mongoose.model('GradeThreshold', gradeThresholdSchema);