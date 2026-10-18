const mongoose = require('mongoose');

// A single-document-per-sequence counter, used to hand out 'S001' / 'T001' style
// ids atomically.
//
// WHY THIS EXISTS
// ───────────────
// Every route that created a record used to do:
//
//     const count = await Student.countDocuments();
//     const id = 'S' + String(count + 1).padStart(3, '0');
//
// which is broken in two separate ways:
//
//   1. DELETES. With 5 students (S001-S005), delete S003 and the count drops to
//      4, so the next student is created as S005 - a duplicate. The unique index
//      rejects it with a raw E11000, and the admin sees "Failed to create
//      student" with no idea why. It then fails forever, because every retry
//      computes the same colliding id.
//
//   2. CONCURRENCY. Two admins clicking Save at the same moment both read
//      count = 5 and both try to create S006. One wins, one gets an error.
//
// findOneAndUpdate with $inc is a single atomic operation on the server, so
// every caller is guaranteed a different number, and the sequence never goes
// backwards when a record is deleted.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },   // e.g. 'student', 'teacher'
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model('Counter', counterSchema);
