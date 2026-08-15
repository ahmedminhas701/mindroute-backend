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
  weeks: [weekSchema],
});

module.exports = mongoose.model('Course', courseSchema);