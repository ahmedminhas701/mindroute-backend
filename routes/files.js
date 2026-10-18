const express = require('express');
const path = require('path');
const fs = require('fs');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const Course = require('../models/Course');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// GET /api/files/:filename - assignment files, for their owner, their course teacher, or an admin
router.get('/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(filename) || filename.includes('..')) {
      return res.status(400).json({ message: 'Invalid file name.' });
    }
    const url = `/uploads/${filename}`;
    const owner = await Student.findOne({ 'assignments.fileUrl': url }, { email: 1, assignments: 1 });
    if (!owner) return res.status(404).json({ message: 'File not found.' });
    const assign = owner.assignments.find(a => a.fileUrl === url);

    let allowed = false;
    if (req.user.role === 'admin') allowed = true;
    else if (req.user.role === 'student') allowed = owner.email === req.user.email;
    else if (req.user.role === 'teacher') {
      const me = await Teacher.findOne({ email: req.user.email }, { id: 1 }).lean();
      const course = await Course.findOne({ id: assign.courseId }, { teacher: 1 }).lean();
      allowed = !!(me && course && course.teacher === me.id);
    }
    if (!allowed) return res.status(403).json({ message: 'You do not have access to this file.' });

    const full = path.join(UPLOAD_DIR, filename);
    if (!full.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(full)) {
      return res.status(404).json({ message: 'File not found.' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.download(full, assign.fileName || filename);
  } catch (err) {
    console.error('GET /files failed:', err);
    res.status(500).json({ message: 'Could not open the file.' });
  }
});

module.exports = router;