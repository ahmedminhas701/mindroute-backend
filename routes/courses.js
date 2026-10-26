const express = require('express');
const router = express.Router();

const Course = require('../models/Course');
const Teacher = require('../models/Teacher');
const Batch = require('../models/Batch');
const Student = require('../models/Student');
const EntryTest = require('../models/EntryTest');
const { protect, restrictTo } = require('../middleware/auth');
const V = require('../utils/validate');
const { resolveSubjectsOr400 } = require('../utils/subjects');
const { teacherForSubject, enrollStudentsInBatchCourses } = require('../utils/courseSync');
const { notifyStudents, notifyTeacher, notifyCourseStudents } = require('../utils/notify');

router.use(protect);

// Teacher is NOT client-writable: it is always derived from the course's batch
// (Batch.subjectTeachers[subject]). Batch and subject are fixed at creation.
const COURSE_CREATE_FIELDS = ['title', 'subject', 'batchId', 'icon', 'color', 'colorLight', 'description'];
const COURSE_EDIT_FIELDS   = ['title', 'icon', 'color', 'colorLight', 'description'];

const CONTENT_TYPES = ['video', 'notes', 'quiz', 'assign', 'link'];

const CONTENT_EDITABLE = {
  video:  ['label', 'url', 'duration'],
  notes:  ['label', 'url'],
  quiz:   ['label'],
  assign: ['label', 'detail', 'totalMarks'],
  link:   ['label', 'url'],
};

function asIndex(raw) {
  const s = String(raw);
  if (!/^\d+$/.test(s)) return -1;
  const n = parseInt(s, 10);
  return n > 10000 ? -1 : n;
}
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

async function loadCourse(res, rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id)) { res.status(400).json({ message: 'Invalid course id.' }); return null; }
  const course = await Course.findOne({ id });
  if (!course) { res.status(404).json({ message: 'Course not found.' }); return null; }
  return course;
}

/**
 * A teacher may edit a course only if THIS course's batch assigns them to the
 * course's subject. The batch's assignment is the single source of truth.
 */
async function mayEditCurriculum(req, res, course) {
  if (req.user.role === 'admin') return true;

  const teacher = await Teacher.findOne({ email: req.user.email }).lean();
  if (!teacher) { res.status(403).json({ message: 'No teacher profile is linked to your account.' }); return false; }

  const batch = await Batch.findOne({ id: course.batchId }).lean();
  if (batch && teacherForSubject(batch, course.subject) === teacher.id) return true;

  res.status(403).json({ message: 'You can only edit courses you teach in this batch.' });
  return false;
}

async function visibleCourseFilter(req) {
  if (req.user.role === 'admin') return {};
  if (req.user.role === 'student') {
    const me = await Student.findOne({ email: req.user.email }, { enrolledCourseIds: 1 }).lean();
    return { id: { $in: (me && me.enrolledCourseIds) || [] } };
  }
  const t = await Teacher.findOne({ email: req.user.email }, { id: 1 }).lean();
  return { teacher: t ? t.id : '__none__' };
}

function hideAnswers(course) {
  (course.weeks || []).forEach(w => (w.topics || []).forEach(t => (t.contents || []).forEach(c => {
    if (c.type === 'quiz' && Array.isArray(c.questions)) {
      c.questions = c.questions.map(q => ({ q: q.q, options: q.options }));
    }
  })));
  return course;
}

// GET /api/courses
router.get('/', async (req, res) => {
  try {
    const courses = await Course.find(await visibleCourseFilter(req)).sort({ id: 1 }).lean();
    res.json(req.user.role === 'student' ? courses.map(hideAnswers) : courses);
  } catch (err) {
    console.error('GET /courses failed:', err);
    res.status(500).json({ message: 'Failed to fetch courses.' });
  }
});

// GET /api/courses/:id
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid course id.' });
    const course = await Course.findOne({ $and: [{ id }, await visibleCourseFilter(req)] }).lean();
    if (!course) return res.status(404).json({ message: 'Course not found.' });
    res.json(req.user.role === 'student' ? hideAnswers(course) : course);
  } catch (err) {
    console.error('GET /courses/:id failed:', err);
    res.status(500).json({ message: 'Failed to load course.' });
  }
});

// POST /api/courses  { batchId, subject, title, icon?, color?, colorLight?, description? }
router.post('/', restrictTo('admin'), async (req, res) => {
  try {
    const body = V.pick(req.body, COURSE_CREATE_FIELDS);

    const titleR = V.normalizeText(body.title, { label: 'Course title', min: 2, max: 100 });
    if (!titleR.ok || !titleR.value) {
      const msg = titleR.error || 'Course title is required.';
      return res.status(400).json({ message: msg, errors: { title: msg } });
    }

    if (!body.batchId) {
      return res.status(400).json({ message: 'Pick a batch for this course.', errors: { batchId: 'Pick a batch.' } });
    }
    const batch = await Batch.findOne({ id: String(body.batchId) });
    if (!batch) {
      return res.status(400).json({ message: 'That batch does not exist.', errors: { batchId: 'Invalid batch.' } });
    }
    const entryTest = await EntryTest.findOne({ id: batch.entryTestId });
    if (!entryTest) {
      return res.status(400).json({ message: `${batch.name}'s entry test no longer exists. Fix the batch first.`, errors: { batchId: 'This batch has no valid entry test.' } });
    }

    const subjects = await resolveSubjectsOr400(res, [body.subject], 'Subject');
    if (!subjects) return;
    if (!subjects.length) {
      return res.status(400).json({ message: 'Pick a subject for this course.', errors: { subject: 'Pick a subject.' } });
    }
    const subject = subjects[0];

    if (!entryTest.subjects.includes(subject)) {
      return res.status(400).json({
        message: `${subject} is not one of ${batch.name}'s subjects (${entryTest.subjects.join(', ')}).`,
        errors: { subject: `Not a subject of ${batch.name}.` },
      });
    }

    // One course per subject per batch.
    const dup = await Course.findOne({ batchId: batch.id, subject }, { id: 1, title: 1 }).lean();
    if (dup) {
      return res.status(409).json({
        message: `${batch.name} already has a ${subject} course ("${dup.title}").`,
        errors: { subject: `${batch.name} already has a ${subject} course.` },
      });
    }

    // The teacher is whoever this batch assigns to this subject.
    const teacherId = teacherForSubject(batch, subject);
    if (!teacherId) {
      return res.status(400).json({
        message: `No teacher is assigned to ${subject} in ${batch.name}. Assign one on the Batches page first.`,
        errors: { subject: `No teacher assigned to ${subject} in this batch.` },
      });
    }
    const teacher = await Teacher.findOne({ id: teacherId }).lean();
    if (!teacher || !(teacher.subjects || []).includes(subject)) {
      return res.status(400).json({
        message: `${batch.name}'s ${subject} assignment is out of date (that teacher no longer exists or no longer teaches ${subject}). Re-assign it on the Batches page.`,
        errors: { subject: 'The batch teacher assignment for this subject is invalid.' },
      });
    }

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
          teacher: teacher.id,
          description: typeof body.description === 'string' ? body.description.trim().slice(0, 1000) : '',
          weeks: [],
        });
      } catch (err) {
        if (err.code !== 11000) throw err;
        // Two admins creating the same batch+subject at once: say so, rather than retrying.
        if (err.keyPattern && err.keyPattern.batchId) {
          return res.status(409).json({ message: `${batch.name} already has a ${subject} course.`, errors: { subject: 'Already exists in this batch.' } });
        }
        // otherwise the numeric id was raced; loop and take the next one
      }
    }
    if (!course) return res.status(409).json({ message: 'Could not assign a course id. Please try again.' });

    // Everything after this point must succeed, or the course is rolled back,
    // so "failed" always means "nothing was created".
    try {
      await Teacher.updateOne({ id: teacher.id }, { $addToSet: { courseIds: course.id } });
      await enrollStudentsInBatchCourses(batch.studentIds, batch.id);
    } catch (sideErr) {
      console.error('Course setup failed, rolling back:', sideErr);
      await Course.deleteOne({ id: course.id }).catch(() => {});
      await Teacher.updateOne({ id: teacher.id }, { $pull: { courseIds: course.id } }).catch(() => {});
      await Student.updateMany({ enrolledCourseIds: course.id }, { $pull: { enrolledCourseIds: course.id } }).catch(() => {});
      return res.status(500).json({ message: 'The course could not be set up, so it was not created. Please try again.' });
    }
    await notifyStudents(batch.studentIds, { type: 'change', title: 'New course available', body: `${esc(course.title)} (${subject}) has been added to ${batch.name}.` });
    await notifyTeacher(teacher.id, { type: 'change', title: 'New course assigned', body: `You have been assigned to teach ${esc(course.title)} in ${batch.name}.` });
    res.status(201).json(course);
  } catch (err) {
    console.error('POST /courses failed:', err);
    res.status(500).json({ message: 'Failed to create course.' });
  }
});

// PUT /api/courses/:id - appearance/text only. Batch, subject and teacher are
// not editable here: the batch decides the teacher, and moving a course to
// another batch/subject is delete + recreate.
router.put('/:id', restrictTo('admin'), async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (!course) return;

    const body = V.pick(req.body, COURSE_EDIT_FIELDS);

    if (body.title !== undefined) {
      const titleR = V.normalizeText(body.title, { label: 'Course title', min: 2, max: 100 });
      if (!titleR.ok || !titleR.value) {
        const msg = titleR.error || 'Course title is required.';
        return res.status(400).json({ message: msg, errors: { title: msg } });
      }
      course.title = titleR.value;
    }
    if (body.description !== undefined) course.description = String(body.description).trim().slice(0, 1000);
    if (body.icon !== undefined && String(body.icon).trim()) course.icon = String(body.icon).trim().toUpperCase().slice(0, 2);
    if (body.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(body.color)) course.color = body.color;
    if (body.colorLight !== undefined && /^#[0-9a-fA-F]{6}$/.test(body.colorLight)) course.colorLight = body.colorLight;

    await course.save();
    res.json(course);
  } catch (err) {
    console.error('PUT /courses/:id failed:', err);
    res.status(500).json({ message: 'Failed to update course.' });
  }
});

// DELETE /api/courses/:id
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  try {
    const course = await loadCourse(res, req.params.id);
    if (!course) return;

    const enrolled = await Student.countDocuments({ enrolledCourseIds: course.id });
    if (enrolled > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        message: `${enrolled} student(s) are enrolled in "${esc(course.title)}". Deleting it removes their access to its content. Resend with ?force=true to confirm.`,
        enrolledCount: enrolled,
      });
    }

    await Course.deleteOne({ id: course.id });
    const enrolledStudents = await Student.find({ enrolledCourseIds: course.id }, { id: 1 }).lean();
    await Student.updateMany({ enrolledCourseIds: course.id }, { $pull: { enrolledCourseIds: course.id } });
    await Teacher.updateMany({ courseIds: course.id }, { $pull: { courseIds: course.id } });
    await notifyStudents(enrolledStudents.map(s => s.id), { type: 'change', title: 'Course removed', body: `${esc(course.title)} is no longer available.` });
    await notifyTeacher(course.teacher, { type: 'change', title: 'Course removed', body: `${esc(course.title)} has been removed.` });

    res.json({ message: 'Course removed.', unenrolled: enrolled });
  } catch (err) {
    console.error('DELETE /courses/:id failed:', err);
    res.status(500).json({ message: 'Failed to remove course.' });
  }
});

// ── Weeks (curriculum - teachers own this) ──────────────────────────────

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
    await notifyCourseStudents(course.id, { type: 'upload', title: 'New topic added', body: `${esc(course.title)}: "${titleR.value}" has been added.` });
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

// DELETE /api/courses/:id/weeks/:weekIndex - also renumbers remaining weeks
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
    if (req.body.dueDate !== undefined) {
      await notifyCourseStudents(course.id, { type: 'due', title: 'Due date updated', body: topic.dueDate
        ? `${esc(course.title)}: "${topic.title}" is due ${topic.dueDate}.`
        : `${esc(course.title)}: "${topic.title}" no longer has a due date.` });
    }
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
      video:  { type: 'video',  label: 'Recorded Lecture', url: '', duration: '-' },
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
      // tracking - a collision silently merges two topics' completion state.
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
    const prevUrl = String(content.url || '');

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
      // A link must be a full http(s) address with no spaces or quotes, so it can never break out of the href it is placed in.
      if (url && !/^(https?:\/\/[^\s"'<>`\\]+|\/(?!\/)[^\s"'<>`\\]*)$/i.test(url)) {
        return res.status(400).json({ message: 'Enter a full link starting with http:// or https:// (no spaces or quotes).' });
      }
      content.url = url.slice(0, 500);
    } else {
      const text = String(value == null ? '' : value).slice(0, field === 'detail' ? 2000 : 200);
      if (field !== 'detail' && /[<>]/.test(text)) {
        return res.status(400).json({ message: 'That field cannot contain < or >.' });
      }
      content[field] = text;
    }

    course.markModified('weeks');
    await course.save();
    if (field === 'url' && !prevUrl && content.url) {
      await notifyCourseStudents(course.id, { type: 'upload', title: 'New material', body: `${course.title}: "${content.label || content.type}" is now available.` });
    }
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
    // fail here - it fails later, in the student's browser, mid-quiz, where
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
