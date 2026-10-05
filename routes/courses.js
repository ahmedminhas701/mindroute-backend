const express = require('express');
const router = express.Router();

const Course = require('../models/Course');
const Teacher = require('../models/Teacher');
const Batch = require('../models/Batch'); 
const { enrollStudentsInBatchCourses } = require('./batches');  

const { protect, restrictTo } = require('../middleware/auth');
const V = require('../utils/validate');
const { resolveSubjectsOr400, getSubjectNames } = require('../utils/subjects');

router.use(protect);

// Admins own the course record (title/subject/teacher/appearance).
// Teachers own the curriculum inside it (weeks, topics, contents).
// That split is enforced per-route below, not just by convention.
const COURSE_META_WRITABLE = ['title', 'subject', 'icon', 'color', 'colorLight', 'teacher', 'description', 'batchId'];

const CONTENT_TYPES = ['video', 'notes', 'quiz', 'assign', 'link'];

// Which fields each content type is allowed to have set through the generic
// single-field update route. Previously that route did `content[field] = value`
// with NO restriction on `field`, which is both a prototype-pollution vector
// (field: '__proto__') and a way to write arbitrary junk into a Mixed subdoc.
const CONTENT_EDITABLE = {
  video:  ['label', 'url', 'duration'],
  notes:  ['label', 'url'],
  quiz:   ['label'],
  assign: ['label', 'detail', 'totalMarks'],
  link:   ['label', 'url'],
};

/** Parse an array index from a URL param. */
function asIndex(raw) {
  const s = String(raw);
  if (!/^\d+$/.test(s)) return -1;      // rejects '-1', '1.5', 'abc', ''
  const n = parseInt(s, 10);
  return n > 10000 ? -1 : n;
}

/**
 * Resolve a week/topic/content by index, or send a 404 and return null.
 *
 * The index check matters more than it looks. The old delete routes called
 * `week.topics.splice(req.params.topicIndex, 1)` with the raw string param.
 * splice() coerces a non-numeric argument to 0, so
 * DELETE /courses/1/weeks/0/topics/abc deleted topic 0 — a completely different
 * topic from the one requested, with a 200 OK and no warning.
 */
function getWeek(res, course, rawIndex) {
  const i = asIndex(rawIndex);
  const week = i >= 0 ? course.weeks[i] : null;
  if (!week) { res.status(404).json({ message: 'Week not found.' }); return null; }
  return week;
}
function getTopic(res, course, rawWeek, rawTopic) {
  const week = getWeek(res, course, rawWeek);
  if (!week) return null;
  const i = asIndex(rawTopic);
  const topic = i >= 0 ? week.topics[i] : null;
  if (!topic) { res.status(404).json({ message: 'Topic not found.' }); return null; }
  return topic;
}
function getContent(res, course, rawWeek, rawTopic, rawContent) {
  const topic = getTopic(res, course, rawWeek, rawTopic);
  if (!topic) return null;
  const i = asIndex(rawContent);
  const content = i >= 0 ? topic.contents[i] : null;
  if (!content) { res.status(404).json({ message: 'Content item not found.' }); return null; }
  return content;
}

/** Load a course or 404. */
async function loadCourse(res, rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id)) { res.status(400).json({ message: 'Invalid course id.' }); return null; }
  const course = await Course.findOne({ id });
  if (!course) { res.status(404).json({ message: 'Course not found.' }); return null; }
  return course;
}

/**
 * A teacher may only touch the curriculum of a course belonging to a batch
 * they are actually assigned to teach that subject in.
 *
 * This is the enforcement point for "every batch's course is separate, even
 * with the same teacher": before, this checked ANY batch mapping the teacher
 * to the course's subject, regardless of which batch. Now it must be the
 * SAME batch the course itself belongs to (course.batchId), so a teacher
 * assigned to Biology in Batch Alpha cannot edit Batch Beta's Biology course
 * even though both are nominally "Biology" and even if they also teach Beta.
 */
async function mayEditCurriculum(req, res, course) {
  if (req.user.role === 'admin') return true;

  const teacher = await Teacher.findOne({ email: req.user.email });
  if (!teacher) { res.status(403).json({ message: 'No teacher profile is linked to your account.' }); return false; }

  // Direct assignment on the course record — an admin explicitly picked this
  // teacher for this specific course. Not batch-mediated, so it's unaffected
  // by which batch the course belongs to.
  if (course.teacher && teacher.id === course.teacher) return true;
  if (course.teacher && teacher.name && course.teacher === teacher.name) return true;
  if ((teacher.courseIds || []).includes(course.id)) return true;

  // Batch-mediated assignment: must be THIS course's batch specifically.
  const batch = await Batch.findOne({ id: course.batchId });
  if (batch && batch.subjectTeachers) {
    const map = batch.subjectTeachers instanceof Map ? batch.subjectTeachers : new Map(Object.entries(batch.subjectTeachers));
    if (map.get(course.subject) === teacher.id) return true;
  }

  res.status(403).json({ message: 'You can only edit courses you teach in this batch.' });
  return false;
}

// ── Course records ──────────────────────────────────────────────────────

// GET /api/courses — every logged-in role can read the catalogue
router.get('/', async (req, res) => {
  try {
    const courses = await Course.find({}).sort({ id: 1 });
    res.json(courses);
  } catch (err) {
    console.error('GET /courses failed:', err);
    res.status(500).json({ message: 'Failed to fetch courses.' });
  }
});

// GET /api/courses/options — dropdown data for the Add/Edit Course modal.
router.get('/options', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const teachers = await Teacher.find({ status: 'active' }, { id: 1, name: 1, subjects: 1 }).sort({ name: 1 }).lean();
    const batches = await Batch.find({}, { id: 1, name: 1, entryTestId: 1 }).sort({ name: 1 }).lean();
    res.json({ subjects: await getSubjectNames(), teachers, batches });
  } catch (err) {
    console.error('GET /courses/options failed:', err);
    res.status(500).json({ message: 'Failed to load form options.' });
  }
});

// GET /api/courses/:id
router.get('/:id', async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (course) res.json(course);
  } catch (err) {
    console.error('GET /courses/:id failed:', err);
    res.status(500).json({ message: 'Failed to load course.' });
  }
});

// POST /api/courses
router.post('/', restrictTo('admin'), async (req, res) => {
  try {
    const body = V.pick(req.body, COURSE_META_WRITABLE);

    const titleR = V.normalizeText(body.title, { label: 'Course title', min: 2, max: 100 });
    if (!titleR.ok || !titleR.value) {
      return res.status(400).json({ message: titleR.error || 'Course title is required.', errors: { title: titleR.error || 'Course title is required.' } });
    }

    if (!body.batchId) {
      return res.status(400).json({ message: 'Pick a batch for this course.', errors: { batchId: 'Pick a batch.' } });
    }
    const batch = await Batch.findOne({ id: body.batchId });
    if (!batch) {
      return res.status(400).json({ message: 'That batch does not exist.', errors: { batchId: 'Invalid batch.' } });
    }

    const subjects = await resolveSubjectsOr400(res, [body.subject], 'Subject');
    if (!subjects) return;
    if (!subjects.length) {
      return res.status(400).json({ message: 'Pick a subject for this course.', errors: { subject: 'Pick a subject.' } });
    }
    const subject = subjects[0];

    // A course's subject should actually belong to its batch's program —
    // otherwise the course can never be reached through enrollment at all
    // (see enrollStudentsInBatchCourses in routes/batches.js, which matches
    // strictly on batchId + subject-in-entryTest).
    const entryTest = await require('../models/EntryTest').findOne({ id: batch.entryTestId });
    if (entryTest && !entryTest.subjects.includes(subject)) {
      return res.status(400).json({
        message: `${subject} isn't one of ${batch.entryTest}'s subjects, so students in this batch would never see this course. Pick a subject from: ${entryTest.subjects.join(', ')}.`,
        errors: { subject: `Not part of ${batch.entryTest}.` },
      });
    }

    const dup = await Course.findOne({ batchId: batch.id, subject }, { id: 1 }).lean();
    if (dup) {
      return res.status(409).json({
        message: `${batch.name} already has a ${subject} course.`,
        errors: { subject: `${batch.name} already has a course for this subject.` },
      });
    }

    const teacherId = await resolveTeacherRef(res, body.teacher, subject);
    if (teacherId === undefined) return;

    let course = null;
    for (let attempt = 0; attempt < 5 && !course; attempt++) {
      const highest = await Course.findOne({}, { id: 1 }).sort({ id: -1 }).lean();
      const nextCourseId = (highest && Number.isFinite(highest.id) ? highest.id : 0) + 1 + attempt;
      try {
        course = await Course.create({
          id: nextCourseId,
          title: titleR.value,
          subject,
          batchId: batch.id,
          icon: (typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim() : subject.charAt(0)).toUpperCase().slice(0, 2),
          color: /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#1B5FAD',
          colorLight: /^#[0-9a-fA-F]{6}$/.test(body.colorLight || '') ? body.colorLight : '#EBF2FB',
          teacher: teacherId,
          description: typeof body.description === 'string' ? body.description.trim().slice(0, 1000) : '',
          weeks: [],
        });
      } catch (err) {
        if (err.code !== 11000) throw err;
      }
    }
    if (!course) return res.status(409).json({ message: 'Could not assign a course id. Please try again.' });

    if (teacherId) await Teacher.updateOne({ id: teacherId }, { $addToSet: { courseIds: course.id } });

    // A course created after the batch already has enrolled students needs
    // enrollment run retroactively — otherwise it exists but nobody in the
    // batch can see it until an unrelated batch edit happens to re-trigger it.
    const { enrollStudentsInBatchCourses } = require('./batches.internal');
    if (batch.studentIds?.length) await enrollStudentsInBatchCourses(batch.studentIds, batch.entryTestId, batch.id);

    res.status(201).json(course);
  } catch (err) {
    console.error('POST /courses failed:', err);
    res.status(400).json({ message: 'Failed to create course.' });
  }
});


// PUT /api/courses/:id — batchId is intentionally NOT editable here. Moving a
// course to a different batch after it has content and enrolled students is
// a data-migration operation, not a metadata edit — it isn't supported
// through this route. Delete and recreate under the correct batch instead.
router.put('/:id', restrictTo('admin'), async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (!course) return;

    const body = V.pick(req.body, COURSE_META_WRITABLE.filter(f => f !== 'batchId'));
    const previousTeacher = course.teacher;

    if (body.title !== undefined) {
      const titleR = V.normalizeText(body.title, { label: 'Course title', min: 2, max: 100 });
      if (!titleR.ok || !titleR.value) {
        return res.status(400).json({ message: titleR.error || 'Course title is required.', errors: { title: titleR.error || 'Course title is required.' } });
      }
      course.title = titleR.value;
    }

    if (body.subject !== undefined) {
      const subjects = await resolveSubjectsOr400(res, [body.subject], 'Subject');
      if (!subjects) return;
      if (!subjects.length) return res.status(400).json({ message: 'Pick a subject for this course.', errors: { subject: 'Pick a subject.' } });

      if (subjects[0] !== course.subject) {
        const dup = await Course.findOne({ batchId: course.batchId, subject: subjects[0], id: { $ne: course.id } }, { id: 1 }).lean();
        if (dup) {
          return res.status(409).json({ message: `This batch already has a ${subjects[0]} course.`, errors: { subject: 'Already exists in this batch.' } });
        }
        const enrolled = await require('../models/Student').countDocuments({ enrolledCourseIds: course.id });
        if (enrolled > 0 && req.query.force !== 'true') {
          return res.status(409).json({
            message: `Changing the subject from ${course.subject} to ${subjects[0]} will re-derive who can see this course, ` +
                     `and ${enrolled} student(s) are currently enrolled. Resend with ?force=true to continue.`,
            enrolledCount: enrolled,
          });
        }
      }
      course.subject = subjects[0];
    }

    if (body.teacher !== undefined) {
      const teacherId = await resolveTeacherRef(res, body.teacher, course.subject);
      if (teacherId === undefined) return;
      course.teacher = teacherId;
    }

    if (body.description !== undefined) course.description = String(body.description).trim().slice(0, 1000);
    if (body.icon !== undefined && String(body.icon).trim()) course.icon = String(body.icon).trim().toUpperCase().slice(0, 2);
    if (body.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(body.color)) course.color = body.color;
    if (body.colorLight !== undefined && /^#[0-9a-fA-F]{6}$/.test(body.colorLight)) course.colorLight = body.colorLight;

    await course.save();

    if (body.teacher !== undefined && previousTeacher !== course.teacher) {
      if (previousTeacher) await Teacher.updateOne({ id: previousTeacher }, { $pull: { courseIds: course.id } });
      if (course.teacher)  await Teacher.updateOne({ id: course.teacher }, { $addToSet: { courseIds: course.id } });
    }

    res.json(course);
  } catch (err) {
    console.error('PUT /courses/:id failed:', err);
    res.status(400).json({ message: 'Failed to update course.' });
  }
});

// DELETE /api/courses/:id
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (!course) return;

    const Student = require('../models/Student');
    const enrolled = await Student.countDocuments({ enrolledCourseIds: course.id });
    if (enrolled > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        message: `${enrolled} student(s) are enrolled in "${course.title}". Deleting it removes their progress, quiz scores and assignments for this course. Resend with ?force=true to confirm.`,
        enrolledCount: enrolled,
      });
    }

    await Course.deleteOne({ id: course.id });

    // Cascade, so nothing is left referencing a course that no longer exists —
    // a stale id in enrolledCourseIds renders as an empty card on the student's
    // dashboard, and in courseIds inflates the teacher's course count.
    await Student.updateMany({ enrolledCourseIds: course.id }, { $pull: { enrolledCourseIds: course.id } });
    await Teacher.updateMany({ courseIds: course.id }, { $pull: { courseIds: course.id } });

    res.json({ message: 'Course removed.', unenrolled: enrolled });
  } catch (err) {
    console.error('DELETE /courses/:id failed:', err);
    res.status(500).json({ message: 'Failed to remove course.' });
  }
});

/**
 * Accept a teacher id ('T001'), a teacher name, or blank/unassigned, and return
 * the canonical teacher id ('' when unassigned).
 *
 * Returns undefined after sending a 400. Course.teacher was a free-text string
 * before, so a typo'd name meant the course displayed a teacher who had no way
 * to reach it.
 */
async function resolveTeacherRef(res, raw, subject) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return '';

  const needle = String(raw).trim();
  let teacher = await Teacher.findOne({ id: needle }).lean();
  if (!teacher) {
    teacher = await Teacher.findOne({ name: new RegExp('^' + V.escapeRegex(needle) + '$', 'i') }).lean();
  }
  if (!teacher) {
    const all = await Teacher.find({}, { id: 1, name: 1 }).lean();
    res.status(400).json({
      message: `No teacher matches "${needle}". Choose one from the list${all.length ? ': ' + all.map(t => `${t.name} (${t.id})`).join(', ') : ' (no teachers have been added yet)'}.`,
      errors: { teacher: 'Choose a teacher from the list.' },
    });
    return undefined;
  }
  // A warning, not an error: assigning a Physics teacher to a Chemistry course
  // is unusual but might be deliberate cover. It IS worth flagging, because the
  // batch-derived enrolment path only matches on subject, so the assignment can
  // look right on the course record and still not give them access.
  if (subject && Array.isArray(teacher.subjects) && teacher.subjects.length && !teacher.subjects.includes(subject)) {
    res.status(400).json({
      message: `${teacher.name} doesn't teach ${subject} (they teach ${teacher.subjects.join(', ')}). ` +
               `Add ${subject} to their profile first, or pick a different teacher.`,
      errors: { teacher: `This teacher doesn't teach ${subject}.` },
    });
    return undefined;
  }
  return teacher.id;
}

// ── Weeks (curriculum — teachers own this) ──────────────────────────────

// POST /api/courses/:id/weeks  { title }
router.post('/:id/weeks', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (!course) return;
    if (!(await mayEditCurriculum(req, res, course))) return;

    const titleR = V.normalizeText(req.body.title, { label: 'Week title', min: 2, max: 120 });
    if (!titleR.ok || !titleR.value) {
      return res.status(400).json({ message: titleR.error || 'Week title is required.' });
    }
    if (course.weeks.length >= 100) {
      return res.status(400).json({ message: 'This course already has 100 weeks.' });
    }

    course.weeks.push({
      num: course.weeks.length + 1,
      title: titleR.value,
      uploadedDate: new Date().toISOString().slice(0, 10),   // sortable; was a locale string
      topics: [],
    });
    await course.save();
    res.status(201).json(course);
  } catch (err) {
    console.error('POST week failed:', err);
    res.status(400).json({ message: 'Failed to add the week.' });
  }
});

// PUT /api/courses/:id/weeks/:weekIndex  { title }
router.put('/:id/weeks/:weekIndex', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (!course) return;
    if (!(await mayEditCurriculum(req, res, course))) return;
    const week = getWeek(res, course, req.params.weekIndex);
    if (!week) return;

    const titleR = V.normalizeText(req.body.title, { label: 'Week title', min: 2, max: 120 });
    if (!titleR.ok || !titleR.value) {
      // The old route assigned req.body.title unconditionally, so an empty
      // rename silently blanked the week heading.
      return res.status(400).json({ message: titleR.error || 'Week title is required.' });
    }
    week.title = titleR.value;
    await course.save();
    res.json(course);
  } catch (err) {
    console.error('PUT week failed:', err);
    res.status(400).json({ message: 'Failed to rename the week.' });
  }
});

// DELETE /api/courses/:id/weeks/:weekIndex — also renumbers remaining weeks
router.delete('/:id/weeks/:weekIndex', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (!course) return;
    if (!(await mayEditCurriculum(req, res, course))) return;
    const i = asIndex(req.params.weekIndex);
    if (i < 0 || !course.weeks[i]) return res.status(404).json({ message: 'Week not found.' });

    course.weeks.splice(i, 1);
    course.weeks.forEach((w, n) => {
      w.num = n + 1;
      // Topic numbers embed the week number ("3.2"), so renumbering weeks
      // without renumbering topics left topics labelled under the week they
      // used to belong to.
      w.topics.forEach((t, ti) => { t.num = `${w.num}.${ti + 1}`; });
    });
    await course.save();
    res.json(course);
  } catch (err) {
    console.error('DELETE week failed:', err);
    res.status(400).json({ message: 'Failed to delete the week.' });
  }
});

// ── Topics ──────────────────────────────────────────────────────────────

// POST /api/courses/:id/weeks/:weekIndex/topics  { title, dueDate, contentTypes: [] }
router.post('/:id/weeks/:weekIndex/topics', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (!course) return;
    if (!(await mayEditCurriculum(req, res, course))) return;
    const week = getWeek(res, course, req.params.weekIndex);
    if (!week) return;

    const titleR = V.normalizeText(req.body.title, { label: 'Topic title', min: 2, max: 150 });
    if (!titleR.ok || !titleR.value) {
      return res.status(400).json({ message: titleR.error || 'Topic title is required.' });
    }

    let dueDate = null;
    if (req.body.dueDate) {
      const d = V.normalizeDate(req.body.dueDate, { label: 'Due date' });
      if (!d.ok) return res.status(400).json({ message: d.error });
      dueDate = d.value;
    }

    const defaults = {
      video:  { type: 'video',  label: 'Recorded Lecture', url: '', duration: '—' },
      notes:  { type: 'notes',  label: 'Written Notes', url: '' },
      quiz:   { type: 'quiz',   label: 'Quiz', questions: [] },
      assign: { type: 'assign', label: 'Assignment', detail: 'Submit as PDF.', totalMarks: 10 },
      link:   { type: 'link',   label: 'Reference Link', url: '' },
    };
    const requested = Array.isArray(req.body.contentTypes) ? req.body.contentTypes : [];
    const contents = requested.filter(t => CONTENT_TYPES.includes(t)).map(t => ({ ...defaults[t] }));

    week.topics.push({
      // Date.now() collides if two topics are added in the same millisecond,
      // which a scripted or double-clicked add can do. The random suffix makes
      // the id unique, and topic ids are used as Map keys for progress
      // tracking — a collision silently merges two topics' completion state.
      id: 't' + Date.now() + Math.random().toString(36).slice(2, 6),
      num: `${week.num}.${week.topics.length + 1}`,
      title: titleR.value,
      dueDate,
      contents,
    });
    await course.save();
    res.status(201).json(course);
  } catch (err) {
    console.error('POST topic failed:', err);
    res.status(400).json({ message: 'Failed to add the topic.' });
  }
});

// PUT /api/courses/:id/weeks/:weekIndex/topics/:topicIndex  { title?, dueDate? }
router.put('/:id/weeks/:weekIndex/topics/:topicIndex', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (!course) return;
    if (!(await mayEditCurriculum(req, res, course))) return;
    const topic = getTopic(res, course, req.params.weekIndex, req.params.topicIndex);
    if (!topic) return;

    if (req.body.title !== undefined) {
      const titleR = V.normalizeText(req.body.title, { label: 'Topic title', min: 2, max: 150 });
      if (!titleR.ok || !titleR.value) return res.status(400).json({ message: titleR.error || 'Topic title is required.' });
      topic.title = titleR.value;
    }
    if (req.body.dueDate !== undefined) {
      if (!req.body.dueDate) {
        topic.dueDate = null;
      } else {
        const d = V.normalizeDate(req.body.dueDate, { label: 'Due date' });
        if (!d.ok) return res.status(400).json({ message: d.error });
        topic.dueDate = d.value;
      }
    }
    await course.save();
    res.json(course);
  } catch (err) {
    console.error('PUT topic failed:', err);
    res.status(400).json({ message: 'Failed to update the topic.' });
  }
});

// DELETE /api/courses/:id/weeks/:weekIndex/topics/:topicIndex
router.delete('/:id/weeks/:weekIndex/topics/:topicIndex', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (!course) return;
    if (!(await mayEditCurriculum(req, res, course))) return;
    const week = getWeek(res, course, req.params.weekIndex);
    if (!week) return;
    const ti = asIndex(req.params.topicIndex);
    if (ti < 0 || !week.topics[ti]) return res.status(404).json({ message: 'Topic not found.' });

    week.topics.splice(ti, 1);
    week.topics.forEach((t, i) => { t.num = `${week.num}.${i + 1}`; });
    await course.save();
    res.json(course);
  } catch (err) {
    console.error('DELETE topic failed:', err);
    res.status(400).json({ message: 'Failed to delete the topic.' });
  }
});

// ── Content items within a topic ────────────────────────────────────────

// POST /api/courses/:id/weeks/:wi/topics/:ti/contents  { type }
router.post('/:id/weeks/:wi/topics/:ti/contents', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (!course) return;
    if (!(await mayEditCurriculum(req, res, course))) return;
    const topic = getTopic(res, course, req.params.wi, req.params.ti);
    if (!topic) return;

    const defaults = {
      video:  { type: 'video',  label: 'Recorded Lecture', url: '', duration: '' },
      notes:  { type: 'notes',  label: 'Written Notes',    url: '' },
      quiz:   { type: 'quiz',   label: 'Quiz',             questions: [] },
      assign: { type: 'assign', label: 'Assignment',       detail: '', totalMarks: 10 },
      link:   { type: 'link',   label: 'Reference Link',   url: '' },
    };
    const content = defaults[req.body.type];
    if (!content) {
      return res.status(400).json({ message: `Unknown content type. Choose one of: ${CONTENT_TYPES.join(', ')}.` });
    }
    if (topic.contents.length >= 30) {
      return res.status(400).json({ message: 'This topic already has 30 content items.' });
    }

    topic.contents.push({ ...content });
    await course.save();
    res.status(201).json(course);
  } catch (err) {
    console.error('POST content failed:', err);
    res.status(400).json({ message: 'Failed to add the content item.' });
  }
});

// PUT /api/courses/:id/weeks/:wi/topics/:ti/contents/:ci  { field, value }
router.put('/:id/weeks/:wi/topics/:ti/contents/:ci', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (!course) return;
    if (!(await mayEditCurriculum(req, res, course))) return;
    const content = getContent(res, course, req.params.wi, req.params.ti, req.params.ci);
    if (!content) return;

    const { field, value } = req.body;

    // `content[field] = value` with an unchecked field name was two bugs in one
    // line: assigning to '__proto__' or 'constructor' can poison
    // Object.prototype for the whole Node process, and any other name wrote a
    // junk key into the Mixed subdocument that the renderer then ignored, so the
    // save appeared to work and the value never showed up.
    const allowed = CONTENT_EDITABLE[content.type] || [];
    if (!V.isSafeKey(field) || !allowed.includes(field)) {
      return res.status(400).json({
        message: `"${field}" cannot be edited on a ${content.type} item. Editable fields: ${allowed.join(', ') || 'none'}.`,
      });
    }

    if (field === 'totalMarks') {
      const n = V.toInt(value, { label: 'Total marks', min: 1, max: 1000 });
      if (!n.ok) return res.status(400).json({ message: n.error });
      content.totalMarks = n.value;
    } else if (field === 'url') {
      const url = String(value == null ? '' : value).trim();
      // Blocks javascript: and data: URLs, which would otherwise end up in an
      // href the student clicks — a stored-XSS delivery mechanism.
      if (url && !/^(https?:\/\/|\/)/i.test(url)) {
        return res.status(400).json({ message: 'Links must start with http://, https:// or / (a path on this site).' });
      }
      content.url = url.slice(0, 500);
    } else {
      content[field] = String(value == null ? '' : value).slice(0, field === 'detail' ? 2000 : 200);
    }

    // Mongoose can't detect in-place mutation of a Mixed path on its own.
    // Without this the save is a silent no-op — which is exactly why some
    // content edits appeared to succeed and then reverted on reload.
    course.markModified('weeks');
    await course.save();
    res.json(course);
  } catch (err) {
    console.error('PUT content failed:', err);
    res.status(400).json({ message: 'Failed to update the content item.' });
  }
});

// PUT /api/courses/:id/weeks/:wi/topics/:ti/contents/:ci/questions
router.put('/:id/weeks/:wi/topics/:ti/contents/:ci/questions', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (!course) return;
    if (!(await mayEditCurriculum(req, res, course))) return;
    const content = getContent(res, course, req.params.wi, req.params.ti, req.params.ci);
    if (!content) return;
    if (content.type !== 'quiz') return res.status(404).json({ message: 'Quiz content item not found.' });

    const incoming = Array.isArray(req.body.questions) ? req.body.questions : [];
    if (incoming.length > 100) return res.status(400).json({ message: 'A quiz can have at most 100 questions.' });

    // Questions were stored exactly as sent. A malformed one (no options, or a
    // correct-answer index pointing past the end of the options array) doesn't
    // fail here — it fails later, in the student's browser, mid-quiz, where
    // there's nothing useful to tell them.
    const questions = [];
    for (let i = 0; i < incoming.length; i++) {
      const q = incoming[i] || {};
      const text = String(q.q || q.question || '').trim();
      if (!text) return res.status(400).json({ message: `Question ${i + 1} has no text.` });

      const options = Array.isArray(q.options) ? q.options.map(o => String(o).trim()).filter(Boolean) : [];
      if (options.length < 2) return res.status(400).json({ message: `Question ${i + 1} needs at least two answer options.` });
      if (options.length > 6)  return res.status(400).json({ message: `Question ${i + 1} has too many options (max 6).` });

      const correct = Number(q.correct);
      if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
        return res.status(400).json({ message: `Question ${i + 1} must have a correct answer chosen from its options.` });
      }
      questions.push({
        q: text.slice(0, 500),
        options: options.map(o => o.slice(0, 200)),
        correct,
        explanation: String(q.explanation || '').trim().slice(0, 1000),
      });
    }

    content.questions = questions;
    course.markModified('weeks');
    await course.save();
    res.json(course);
  } catch (err) {
    console.error('PUT questions failed:', err);
    res.status(400).json({ message: 'Failed to save the questions.' });
  }
});

// DELETE /api/courses/:id/weeks/:wi/topics/:ti/contents/:ci
router.delete('/:id/weeks/:wi/topics/:ti/contents/:ci', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (!course) return;
    if (!(await mayEditCurriculum(req, res, course))) return;
    const topic = getTopic(res, course, req.params.wi, req.params.ti);
    if (!topic) return;
    const ci = asIndex(req.params.ci);
    if (ci < 0 || !topic.contents[ci]) return res.status(404).json({ message: 'Content item not found.' });

    topic.contents.splice(ci, 1);
    course.markModified('weeks');
    await course.save();
    res.json(course);
  } catch (err) {
    console.error('DELETE content failed:', err);
    res.status(400).json({ message: 'Failed to delete the content item.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const t0 = Date.now();
    const courses = await Course.find({}).sort({ id: 1 });
    console.log(`DB query: ${Date.now() - t0}ms`);
    const t1 = Date.now();
    res.json(courses);
    console.log(`Total route: ${Date.now() - t1 + (t1 - t0)}ms`);
  } catch (err) {
    console.error('GET /courses failed:', err);
    res.status(500).json({ message: 'Failed to fetch courses.' });
  }
});


module.exports = router;
