const express = require('express');
const router = express.Router();

const GradeThreshold = require('../models/GradeThreshold');
const Student = require('../models/Student');
const { protect, restrictTo } = require('../middleware/auth');
const V = require('../utils/validate');

router.use(protect);

// ── What was wrong with this file ────────────────────────────────────────────
//
// The order check (validateThresholdOrder) was the only validation, and it
// compared `t.min` values without ever checking they were numbers. Three faults
// followed from that, and all three are academy-wide, not per-record:
//
//   1. A non-numeric min — `{ min: "eighty", grade: "A" }` — became NaN. Every
//      comparison against NaN is false, so the order check passed, the sort was
//      undefined behaviour, and calcGrade()'s `pct >= t.min` was false for every
//      threshold. Result: the fallback fired and EVERY STUDENT IN THE ACADEMY
//      was regraded to F in one request.
//   2. Out-of-range mins were accepted. `{ min: 500 }` for A+ is unreachable;
//      `{ min: -10 }` for F makes F match a negative percentage only.
//   3. An unknown grade letter was accepted, because the order check `continue`s
//      past any grade not in GRADE_ORDER. `[{ min: 0, grade: 'Z' }]` stored
//      cleanly and relabelled every grade in the system to 'Z'.
//
// Also: the recompute divided by `a.totalMarks` with no zero check, so an
// assignment saved with a total of 0 produced Infinity, and Infinity >= any
// min is true — that assignment silently became an A+.

// Highest to lowest. This is both the allowed set of letters and the ordering
// the mins have to respect.
const GRADE_ORDER = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D', 'F'];

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

/**
 * Validates and cleans an incoming thresholds array.
 * Returns { ok: true, value: [{min, grade}] } or { ok: false, error }.
 */
function cleanThresholds(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    return { ok: false, error: 'A thresholds array is required.' };
  }
  if (raw.length > GRADE_ORDER.length) {
    return { ok: false, error: `At most ${GRADE_ORDER.length} thresholds are allowed.` };
  }

  const seen = new Set();
  const cleaned = [];

  for (const row of raw) {
    const grade = String((row && row.grade) || '').trim();
    if (!GRADE_ORDER.includes(grade)) {
      return { ok: false, error: `"${grade || '(blank)'}" is not a valid grade. Use one of: ${GRADE_ORDER.join(', ')}.` };
    }
    // Duplicates used to be accepted, with the last one silently winning.
    if (seen.has(grade)) {
      return { ok: false, error: `Grade "${grade}" appears more than once.` };
    }
    seen.add(grade);

    const min = V.toInt(row && row.min, { label: `"${grade}" minimum`, min: 0, max: 100 });
    if (!min.ok) return { ok: false, error: min.error };

    cleaned.push({ grade, min: min.value });
  }

  // Highest grade first, which is the order calcGrade() walks.
  cleaned.sort((a, b) => b.min - a.min);

  // Every grade present must sit strictly below the grade above it. Checked
  // against GRADE_ORDER rather than the submitted order, so sending them
  // shuffled still gets caught.
  const byGrade = {};
  cleaned.forEach(t => { byGrade[t.grade] = t.min; });
  for (let i = 0; i < GRADE_ORDER.length - 1; i++) {
    const higher = GRADE_ORDER[i];
    const lower  = GRADE_ORDER[i + 1];
    if (byGrade[higher] === undefined || byGrade[lower] === undefined) continue;
    if (byGrade[higher] <= byGrade[lower]) {
      return {
        ok: false,
        error: `"${higher}" minimum (${byGrade[higher]}%) must be greater than "${lower}" minimum (${byGrade[lower]}%).`,
      };
    }
  }

  // Without a threshold at or below 0 there is a band at the bottom that no
  // threshold claims. calcGrade() falls back to 'F' there, which is the right
  // answer — but only by accident, and only if 'F' is what you wanted. Make it
  // explicit instead of relying on the fallback.
  const lowest = cleaned[cleaned.length - 1];
  if (lowest.min > 0) {
    return {
      ok: false,
      error: `The lowest grade ("${lowest.grade}") must start at 0%, otherwise marks below ${lowest.min}% have no grade.`,
    };
  }

  return { ok: true, value: cleaned };
}

// GET /api/thresholds — open to every logged-in role. Students need this
// too (calcGradeFromThreshold() runs on the student Performance page).
router.get('/', async (req, res) => {
  try {
    const doc = await getSingleton();
    res.json(doc.thresholds);
  } catch (err) {
    console.error('GET /thresholds failed:', err);
    res.status(500).json({ message: 'Failed to load the grade thresholds.' });
  }
});

// PUT /api/thresholds — mirrors applyThresholds(), then recomputes every
// student's assignment grades, skipping any assignment with manualGrade: true.
// Admin AND teacher can call this — the threshold editor lives on the
// teacher Grading page in app.js, so teacher-only would 403 every teacher.
// body: { thresholds: [{ min, grade }, ...] }
router.put('/', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const clean = cleanThresholds(req.body.thresholds);
    if (!clean.ok) return res.status(400).json({ message: clean.error });
    const sorted = clean.value;

    const doc = await getSingleton();
    doc.thresholds = sorted;
    await doc.save();

    const students = await Student.find({ 'assignments.0': { $exists: true } });
    let updatedCount = 0;
    let skippedBadTotal = 0;

    for (const student of students) {
      let changed = false;
      student.assignments.forEach(a => {
        if (!a.submitted) return;
        if (a.marks === null || a.marks === undefined) return;
        if (a.manualGrade) return;                      // teacher overrode it by hand
        // Guarding the divisor. Without this, totalMarks of 0 or null gave
        // Infinity or NaN and the assignment was regraded to A+ or F at random.
        if (!a.totalMarks || a.totalMarks <= 0) { skippedBadTotal++; return; }
        a.grade = calcGrade(Math.round((a.marks / a.totalMarks) * 100), sorted);
        changed = true;
      });
      if (changed) { await student.save(); updatedCount++; }
    }

    res.json({
      thresholds: doc.thresholds,
      recomputedStudents: updatedCount,
      skippedInvalidTotals: skippedBadTotal,
    });
  } catch (err) {
    console.error('PUT /thresholds failed:', err);
    res.status(500).json({ message: 'Failed to update the grade thresholds.' });
  }
});

module.exports = router;
