const mongoose = require('mongoose');

// ── Schema hardening added 2026-09-02 ────────────────────────────────────────
// This schema had almost no constraints even after Student and Teacher got the
// same treatment. routes/batches.js does the real validation (entry test
// existence, teacher-subject matching, student existence) - this is the last
// line of defence for any write that skips the route (a script, a future
// import, a bug), same rationale as models/Student.js and models/Teacher.js.
const batchSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },

  name: {
    type: String,
    required: [true, 'Batch name is required.'],
    trim: true,
    minlength: 2,
    maxlength: 80,
  },

  // Denormalised display copy of EntryTest.name. Derived server-side from
  // entryTestId in routes/batches.js, never trusted directly from the client -
  // letting the two disagree independently was a real bug (see cleanBatchBody).
  entryTest: { type: String, trim: true, default: '' },

  entryTestId: {
    type: String,
    required: [true, 'An entry test is required.'],
    trim: true,
  },

  startDate: {
    type: String,
    required: [true, 'A start date is required.'],
    validate: {
      validator: v => v === '' || v === null || v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v),
      message: 'Start date must be stored as YYYY-MM-DD.',
    },
  },

  status: {
    type: String,
    enum: { values: ['upcoming', 'active', 'completed'], message: 'Status must be upcoming, active or completed.' },
    default: 'upcoming',
  },

  studentIds: { type: [String], default: [] },

  // subject name -> teacher.id. Keys/values are checked against real
  // Subject/Teacher records in routes/batches.js - the schema can't express
  // "this key must be one of this entry test's subjects", so that stays route-side.
  subjectTeachers: { type: Map, of: String, default: {} },
}, { timestamps: true });

module.exports = mongoose.model('Batch', batchSchema);