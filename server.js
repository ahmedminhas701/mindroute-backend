require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const compression = require('compression');
const app = express();

app.use(cors());
app.use(express.json());

// Serves files saved by middleware/upload.js — a submitted assignment's
// fileUrl ('/uploads/169...-abc.pdf') is fetchable directly at this path.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Routes ────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/students', require('./routes/students'));
app.use('/api/teachers', require('./routes/teachers'));
app.use('/api/batches', require('./routes/batches'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/tests', require('./routes/tests'));
app.use('/api/thresholds', require('./routes/thresholds'));
app.use('/api/schedule', require('./routes/schedule'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/subjects', require('./routes/subjects'));
app.use(compression());


app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ── 404 + error handling ─────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ message: 'Route not found.' }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === 'Unsupported file type.') {
    return res.status(400).json({ message: err.message });
  }
  console.error(err.stack);
  res.status(err.status || 500).json({ message: 'Server error.', error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected.');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
