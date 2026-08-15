const express = require('express');
const router = express.Router();

const GradeThreshold = require('../models/GradeThreshold');
const Student = require('../models/Student');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

// GRADE_THRESHOLDS is one singleton document, not per-student rows.
// Always operate on the first (and only) doc, creating it with schema
// defaults if it doesn't exist yet.
async function getSingleton() {
  let doc = await GradeThreshold.findOne({});
  if (!doc) doc = await GradeThreshold.create({});
  return doc;
}

function calcGrade(pct, thresholds) {
  for (const t of thresholds) if (pct >= t.min) return t.grade;
  return 'F';
}

// GET /api/thresholds — open to every logged-in role. Students need this
// too (calcGradeFromThreshold() runs on the student Performance page).
router.get('/', async (req, res) => {
  const doc = await getSingleton();
  res.json(doc.thresholds);
});

const GRADE_ORDER = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D', 'F'];

function validateThresholdOrder(thresholds) {
  const byGrade = {};
  thresholds.forEach(t => { byGrade[t.grade] = t.min; });
  for (let i = 0; i < GRADE_ORDER.length - 1; i++) {
    const higher = GRADE_ORDER[i], lower = GRADE_ORDER[i + 1];
    if (byGrade[higher] === undefined || byGrade[lower] === undefined) continue;
    if (byGrade[higher] <= byGrade[lower]) {
      return `"${higher}" minimum (${byGrade[higher]}%) must be greater than "${lower}" minimum (${byGrade[lower]}%).`;
    }
  }
  return null;
}

// PUT /api/thresholds — mirrors applyThresholds(), then recomputes every
// student's assignment grades, skipping any assignment with manualGrade: true.
// Admin AND teacher can call this — the threshold editor lives on the
// teacher Grading page in app.js, so teacher-only would 403 every teacher.
// body: { thresholds: [{ min, grade }, ...] }
router.put('/', restrictTo('admin', 'teacher'), async (req, res) => {
  const { thresholds } = req.body;
  if (!Array.isArray(thresholds) || !thresholds.length) {
    return res.status(400).json({ message: 'thresholds array is required.' });
  }
  const orderError = validateThresholdOrder(thresholds);
  if (orderError) return res.status(400).json({ message: orderError });
  
  const sorted = [...thresholds].sort((a, b) => b.min - a.min);

  const doc = await getSingleton();
  doc.thresholds = sorted;
  await doc.save();

  const students = await Student.find({ 'assignments.0': { $exists: true } });
  let updatedCount = 0;
  for (const student of students) {
    let changed = false;
    student.assignments.forEach(a => {
      if (a.submitted && a.marks !== null && a.marks !== undefined && !a.manualGrade) {
        a.grade = calcGrade(Math.round((a.marks / a.totalMarks) * 100), sorted);
        changed = true;
      }
    });
    if (changed) { await student.save(); updatedCount++; }
  }

  res.json({ thresholds: doc.thresholds, recomputedStudents: updatedCount });
});

module.exports = router;
