const Subject = require('../models/Subject');

// ── Canonical subject names ──────────────────────────────────────────────────
//
// THE PROBLEM THIS SOLVES
// ───────────────────────
// Every subject comparison in this codebase is exact string equality:
//
//   Course.subject === batch.subjectTeachers[subject]        (enrollment)
//   entryTest.subjects.includes(course.subject)              (course listing)
//   teacher.subjects.includes(course.subject)                (teacher's courses)
//
// So "Biology", "biology" and "Biology " are three different subjects as far as
// the code is concerned. There is no error when they disagree - the join just
// finds nothing, and a course silently disappears from the student's and the
// teacher's course list. That is the single most confusing failure mode in this
// project, and it was reachable from four different free-text inputs.
//
// The fix has two halves:
//   1. The UI only ever offers a <select> populated from this collection, so a
//      human can't type a variant in the first place.
//   2. The server resolves whatever it receives back to the canonical spelling
//      before storing it. Belt and braces: a stale cached page, a script, or
//      curl can all still send "biology", and we'd rather quietly correct it to
//      "Biology" than store a value that breaks a join later.

/** All canonical subject names, alphabetically. */
async function getSubjectNames() {
  const docs = await Subject.find({}, { name: 1 }).lean();
  return docs.map(d => d.name).sort((a, b) => a.localeCompare(b));
}

/**
 * Resolve one name to its canonical spelling.
 * Case- and whitespace-insensitive; returns null if no such subject exists.
 *
 *   resolveSubject(' biology ')  ->  'Biology'
 *   resolveSubject('Astrology')  ->  null
 */
async function resolveSubject(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const needle = raw.trim().toLowerCase();
  const docs = await Subject.find({}, { name: 1 }).lean();
  const hit = docs.find(d => String(d.name).trim().toLowerCase() === needle);
  return hit ? hit.name : null;
}

/**
 * Resolve a list. Returns { ok, values, unknown }.
 *
 * `values` is de-duplicated and canonically spelled, so ['bio','Biology'] that
 * both resolve to 'Biology' collapses to one entry instead of storing the same
 * subject twice (which would then render as a duplicate chip in the UI).
 */
async function resolveSubjects(rawList) {
  const list = Array.isArray(rawList) ? rawList : [rawList];
  const docs = await Subject.find({}, { name: 1 }).lean();
  const byLower = new Map(docs.map(d => [String(d.name).trim().toLowerCase(), d.name]));

  const values = [];
  const unknown = [];
  list.forEach(raw => {
    if (typeof raw !== 'string' || !raw.trim()) return;
    const canonical = byLower.get(raw.trim().toLowerCase());
    if (!canonical) {
      if (!unknown.includes(raw)) unknown.push(raw);
    } else if (!values.includes(canonical)) {
      values.push(canonical);
    }
  });

  return { ok: unknown.length === 0, values, unknown };
}

/**
 * Express helper: resolve a list or 400 with a message naming the bad values
 * and listing what IS available, so the caller can fix it without guessing.
 * Returns the canonical array, or null if it already sent the response.
 */
async function resolveSubjectsOr400(res, rawList, fieldLabel = 'Subject') {
  const { ok, values, unknown } = await resolveSubjects(rawList);
  if (!ok) {
    const available = await getSubjectNames();
    res.status(400).json({
      message: `${fieldLabel} not recognised: ${unknown.join(', ')}. ` +
               `Choose from the subject list${available.length ? ': ' + available.join(', ') : ' (no subjects have been created yet)'}.`,
      unknownSubjects: unknown,
      availableSubjects: available,
    });
    return null;
  }
  return values;
}

module.exports = { getSubjectNames, resolveSubject, resolveSubjects, resolveSubjectsOr400 };
