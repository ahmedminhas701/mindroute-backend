const mongoose = require('mongoose');

const entryTestSchema = new mongoose.Schema({
  id: { type: String, unique: true },        // 'mdcat' style, slugified name
  name: String,                               // 'MDCAT'
  color: String,                              // '#1B5FAD'
  desc: String,
  subjects: [String],                         // ['Biology', 'Chemistry', 'Physics', 'English']
});

module.exports = mongoose.model('EntryTest', entryTestSchema);