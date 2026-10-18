const mongoose = require('mongoose');

const topicSchema = new mongoose.Schema({
  id: String, num: String, title: String, dueDate: String,
  contents: [mongoose.Schema.Types.Mixed],
}, { _id: false });

const weekSchema = new mongoose.Schema({
  num: Number, title: String, uploadedDate: String,
  topics: [topicSchema],
}, { _id: false });

const courseSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  title: String, subject: String, icon: String, color: String, colorLight: String,
  teacher: String, description: String,

  // A course now belongs to exactly one batch's offering of a subject. Two
  // batches with the same subject and even the same teacher get two entirely
  // separate Course documents - separate curricula, separate edit access -
  // rather than sharing one. See routes/courses.js (mayEditCurriculum) and
  // routes/batches.js (enrollment) for where this is enforced.
  batchId: { type: String, required: [true, 'A course must belong to a batch.'] },

  weeks: [weekSchema],
});

// One course per subject per batch - prevents "MDCAT Alpha" accidentally
// getting two separate Biology courses that would silently split students
// and content between them.
courseSchema.index({ batchId: 1, subject: 1 }, { unique: true });

module.exports = mongoose.model('Course', courseSchema);