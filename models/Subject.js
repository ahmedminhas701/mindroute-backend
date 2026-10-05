const mongoose = require('mongoose');

// ── The canonical list of subjects ───────────────────────────────────────────
//
// This is the root of the relationship chain that makes any course visible:
//
//   Subject -> EntryTest.subjects[] -> Course.subject
//           -> Teacher.subjects[]   -> Batch.subjectTeachers{subject: teacherId}
//           -> Student.enrolledCourseIds
//
// Every link is compared with exact string equality, so the *spelling stored
// here is the contract* the rest of the app is written against.
const subjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Subject name is required.'],
    trim: true,
    minlength: 2,
    maxlength: 40,
  },
  // Core subjects can't be deleted by an admin — they're the ones the seeded
  // entry tests and courses are built on.
  isCore: { type: Boolean, default: false },
}, { timestamps: true });

// Case-INSENSITIVE uniqueness.
//
// `unique: true` alone gives a case-sensitive index, which means MongoDB is
// perfectly happy to store 'Biology' and 'biology' side by side. That is the
// single worst thing that can happen to this collection: you end up with two
// subjects that look identical in the dropdown, with a course filed under one
// and the teacher qualified in the other, and no join between them ever
// matching. The failure is completely silent — the course just never appears.
//
// A collation-backed index makes the database itself refuse the second variant,
// so the guarantee holds even for writes that skip routes/subjects.js (seed
// scripts, a mongo shell, a future import).
//
// strength: 2 = case-insensitive but accent-sensitive.
subjectSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = mongoose.model('Subject', subjectSchema);
