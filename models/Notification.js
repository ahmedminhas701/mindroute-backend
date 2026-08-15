const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  type: String, read: Boolean, title: String, body: String,
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);