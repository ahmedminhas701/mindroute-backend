const express = require('express');
const router = express.Router();

const Course = require('../models/Course');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

// GET /api/courses — every logged-in role can read the catalog
router.get('/', async (req, res) => {
  const courses = await Course.find({});
  res.json(courses);
});

// GET /api/courses/:id — numeric id, matches COURSES[id] in app.js
router.get('/:id', async (req, res) => {
  const course = await Course.findOne({ id: Number(req.params.id) });
  if (!course) return res.status(404).json({ message: 'Course not found.' });
  res.json(course);
});

// POST /api/courses
router.post('/', restrictTo('admin'), async (req, res) => {
  try {
    const course = await Course.create(req.body);
    res.status(201).json(course);
  } catch (err) {
    res.status(400).json({ message: 'Failed to create course.', error: err.message });
  }
});

// PUT /api/courses/:id — full-record edit (title, description, teacher, etc.)
router.put('/:id', restrictTo('admin', 'teacher'), async (req, res) => {
  const course = await Course.findOneAndUpdate({ id: Number(req.params.id) }, req.body, { new: true });
  if (!course) return res.status(404).json({ message: 'Course not found.' });
  res.json(course);
});

// DELETE /api/courses/:id
router.delete('/:id', restrictTo('admin'), async (req, res) => {
  const course = await Course.findOneAndDelete({ id: Number(req.params.id) });
  if (!course) return res.status(404).json({ message: 'Course not found.' });
  res.json({ message: 'Course removed.' });
});

// ── Weeks — mirrors addWeekToEditor() / updateWeekTitle() / deleteWeek() ──

// POST /api/courses/:id/weeks  { title }
router.post('/:id/weeks', restrictTo('admin', 'teacher'), async (req, res) => {
  const course = await Course.findOne({ id: Number(req.params.id) });
  if (!course) return res.status(404).json({ message: 'Course not found.' });
  course.weeks.push({
    num: course.weeks.length + 1,
    title: req.body.title,
    uploadedDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    topics: [],
  });
  await course.save();
  res.status(201).json(course);
});

// PUT /api/courses/:id/weeks/:weekIndex  { title }
router.put('/:id/weeks/:weekIndex', restrictTo('admin', 'teacher'), async (req, res) => {
  const course = await Course.findOne({ id: Number(req.params.id) });
  if (!course) return res.status(404).json({ message: 'Course not found.' });
  const week = course.weeks[req.params.weekIndex];
  if (!week) return res.status(404).json({ message: 'Week not found.' });
  week.title = req.body.title;
  await course.save();
  res.json(course);
});

// DELETE /api/courses/:id/weeks/:weekIndex — also renumbers remaining weeks
router.delete('/:id/weeks/:weekIndex', restrictTo('admin', 'teacher'), async (req, res) => {
  const course = await Course.findOne({ id: Number(req.params.id) });
  if (!course) return res.status(404).json({ message: 'Course not found.' });
  course.weeks.splice(req.params.weekIndex, 1);
  course.weeks.forEach((w, i) => { w.num = i + 1; });
  await course.save();
  res.json(course);
});

// ── Topics — mirrors submitAddTopic() / updateTopicTitle() / updateTopicDue() / deleteTopic() ──

// POST /api/courses/:id/weeks/:weekIndex/topics  { title, dueDate, contentTypes: [] }
router.post('/:id/weeks/:weekIndex/topics', restrictTo('admin', 'teacher'), async (req, res) => {
  const course = await Course.findOne({ id: Number(req.params.id) });
  if (!course) return res.status(404).json({ message: 'Course not found.' });
  const week = course.weeks[req.params.weekIndex];
  if (!week) return res.status(404).json({ message: 'Week not found.' });

  const { title, dueDate = null, contentTypes = [] } = req.body;
  const defaults = {
    video:  { type: 'video',  label: 'Recorded Lecture', duration: '—' },
    notes:  { type: 'notes',  label: 'Written Notes' },
    quiz:   { type: 'quiz',   label: 'Quiz', questions: [] },
    assign: { type: 'assign', label: 'Assignment', detail: 'Submit as PDF.' },
    link:   { type: 'link',   label: 'Reference Link', url: '#' },
  };
  const contents = contentTypes.map(t => defaults[t]).filter(Boolean);
  const ti = week.topics.length + 1;

  week.topics.push({ id: 't' + Date.now(), num: `${week.num}.${ti}`, title, dueDate, contents });
  await course.save();
  res.status(201).json(course);
});

// PUT /api/courses/:id/weeks/:weekIndex/topics/:topicIndex  { title?, dueDate? }
router.put('/:id/weeks/:weekIndex/topics/:topicIndex', restrictTo('admin', 'teacher'), async (req, res) => {
  const course = await Course.findOne({ id: Number(req.params.id) });
  if (!course) return res.status(404).json({ message: 'Course not found.' });
  const topic = course.weeks[req.params.weekIndex]?.topics[req.params.topicIndex];
  if (!topic) return res.status(404).json({ message: 'Topic not found.' });

  if (req.body.title !== undefined) topic.title = req.body.title;
  if (req.body.dueDate !== undefined) topic.dueDate = req.body.dueDate;
  await course.save();
  res.json(course);
});

// DELETE /api/courses/:id/weeks/:weekIndex/topics/:topicIndex — also renumbers
router.delete('/:id/weeks/:weekIndex/topics/:topicIndex', restrictTo('admin', 'teacher'), async (req, res) => {
  const course = await Course.findOne({ id: Number(req.params.id) });
  if (!course) return res.status(404).json({ message: 'Course not found.' });
  const week = course.weeks[req.params.weekIndex];
  if (!week) return res.status(404).json({ message: 'Week not found.' });

  week.topics.splice(req.params.topicIndex, 1);
  week.topics.forEach((t, i) => { t.num = `${week.num}.${i + 1}`; });
  await course.save();
  res.json(course);
});

// ── Content items (video/notes/quiz/assign/link) within a topic ─────────
// mirrors addContentToTopic() / updateContentField() / removeContentFromTopic()

// POST /api/courses/:id/weeks/:wi/topics/:ti/contents  { type }
router.post('/:id/weeks/:wi/topics/:ti/contents', restrictTo('admin', 'teacher'), async (req, res) => {
  const course = await Course.findOne({ id: Number(req.params.id) });
  if (!course) return res.status(404).json({ message: 'Course not found.' });
  const topic = course.weeks[req.params.wi]?.topics[req.params.ti];
  if (!topic) return res.status(404).json({ message: 'Topic not found.' });

  const defaults = {
    video:  { type: 'video',  label: 'Recorded Lecture', url: '', duration: '' },
    notes:  { type: 'notes',  label: 'Written Notes',    url: '' },
    quiz:   { type: 'quiz',   label: 'Quiz',             questions: [] },
    assign: { type: 'assign', label: 'Assignment',       detail: '', totalMarks: 10 },
    link:   { type: 'link',   label: 'Reference Link',   url: '' },
  };
  const content = defaults[req.body.type];
  if (!content) return res.status(400).json({ message: 'Unknown content type.' });

  topic.contents.push(content);
  await course.save();
  res.status(201).json(course);
});

// PUT /api/courses/:id/weeks/:wi/topics/:ti/contents/:ci  { field, value }
// Generic single-field update — covers url/duration/detail/totalMarks/label
// the way updateContentField(cid,wi,ti,ci,field,value) did client-side.
router.put('/:id/weeks/:wi/topics/:ti/contents/:ci', restrictTo('admin', 'teacher'), async (req, res) => {
  const course = await Course.findOne({ id: Number(req.params.id) });
  if (!course) return res.status(404).json({ message: 'Course not found.' });
  const content = course.weeks[req.params.wi]?.topics[req.params.ti]?.contents[req.params.ci];
  if (!content) return res.status(404).json({ message: 'Content item not found.' });

  const { field, value } = req.body;
  if (!field) return res.status(400).json({ message: 'field is required.' });
  content[field] = value;
  await course.save();
  res.json(course);
});

// PUT /api/courses/:id/weeks/:wi/topics/:ti/contents/:ci/questions
// Bulk-replaces a quiz content item's question list — mirrors the
// save button in openQuizEditor()'s modal (app.js §19).
router.put('/:id/weeks/:wi/topics/:ti/contents/:ci/questions', restrictTo('admin', 'teacher'), async (req, res) => {
  const course = await Course.findOne({ id: Number(req.params.id) });
  if (!course) return res.status(404).json({ message: 'Course not found.' });
  const content = course.weeks[req.params.wi]?.topics[req.params.ti]?.contents[req.params.ci];
  if (!content || content.type !== 'quiz') return res.status(404).json({ message: 'Quiz content item not found.' });

  content.questions = req.body.questions || [];
  await course.save();
  res.json(course);
});

// DELETE /api/courses/:id/weeks/:wi/topics/:ti/contents/:ci
router.delete('/:id/weeks/:wi/topics/:ti/contents/:ci', restrictTo('admin', 'teacher'), async (req, res) => {
  const course = await Course.findOne({ id: Number(req.params.id) });
  if (!course) return res.status(404).json({ message: 'Course not found.' });
  const topic = course.weeks[req.params.wi]?.topics[req.params.ti];
  if (!topic) return res.status(404).json({ message: 'Topic not found.' });

  topic.contents.splice(req.params.ci, 1);
  await course.save();
  res.json(course);
});

module.exports = router;
