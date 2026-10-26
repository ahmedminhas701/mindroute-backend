const mongoose = require('mongoose');

const TYPES = [
  'assignment', 'grade', 'schedule', 'fee', 'announcement', 'system',
  'upload', 'due', 'live', 'change', 'overdue', 'quiz',
];

const notificationSchema = new mongoose.Schema({
  userId: { type: String, required: true },          // String(User._id) of the recipient
  type:   { type: String, enum: TYPES, default: 'system' },
  read:   { type: Boolean, default: false },
  title:  { type: String, required: true, trim: true, maxlength: 120 },
  body:   { type: String, trim: true, maxlength: 1000, default: '' },
}, { timestamps: true });

notificationSchema.index({ userId: 1, createdAt: -1 });
// Notifications older than 60 days are deleted automatically.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', notificationSchema);
module.exports.TYPES = TYPES;
