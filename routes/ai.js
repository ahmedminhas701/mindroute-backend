const esc = s => String(s == null ? '' : s);
const express = require('express');
const router = express.Router();

const Student = require('../models/Student');
const Course = require('../models/Course');
const { protect, restrictTo } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

router.use(protect);
router.use(restrictTo('student'));
// Every call here costs money, so each student gets a hard hourly ceiling per endpoint.
router.use(rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyFn: req => [`user:${req.user._id}`],
  message: 'You have used the AI assistant a lot this hour. Please try again later.',
}));

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const MAX_AI_ATTEMPTS = 3;
const clean = s => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/[<>]/g, '').slice(0, 150);

async function callClaude(systemPrompt, userMessage, maxTokens) {
  if (!process.env.ANTHROPIC_API_KEY) { const e = new Error('no key'); e.code = 'NO_KEY'; throw e; }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userMessage }] }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    console.error('Anthropic API error', response.status, (await response.text().catch(() => '')).slice(0, 300));
    throw new Error('upstream');
  }
  const data = await response.json();
  return data.content?.[0]?.text || '';
}

function sendAiError(res, err) {
  if (err.code === 'NO_KEY') return res.status(503).json({ message: 'The AI assistant is not set up yet. Please contact your administrator.' });
  console.error('AI route failed:', err.message);
  return res.status(502).json({ message: 'The AI assistant is unavailable right now. Please try again.' });
}

/** Course, topics and scores all come from the database, never from the request. */
async function loadContext(req, res) {
  const courseId = Number(req.body.courseId);
  const student = await Student.findOne({ email: req.user.email });
  if (!student) { res.status(404).json({ message: 'Student record not found.' }); return null; }
  if (!Number.isInteger(courseId) || !(student.enrolledCourseIds || []).includes(courseId)) {
    res.status(403).json({ message: 'You are not enrolled in that course.' }); return null;
  }
  const course = await Course.findOne({ id: courseId }).lean();
  if (!course) { res.status(404).json({ message: 'Course not found.' }); return null; }

  const wanted = new Set((Array.isArray(req.body.topicIds) ? req.body.topicIds : []).slice(0, 12).map(String));
  const topics = [];
  (course.weeks || []).forEach(w => (w.topics || []).forEach(t => {
    if (!wanted.has(t.id)) return;
    const sc = (student.quizScores || []).find(q => q.topicId === t.id);
    topics.push({ title: clean(t.title), pct: sc && sc.total ? Math.round(sc.score / sc.total * 100) : null });
  }));
  if (!topics.length) { res.status(400).json({ message: 'Attempt at least one quiz first.' }); return null; }
  return { student, course, topics };
}

// POST /api/ai/study-notes  { courseId, topicIds: [] }
router.post('/study-notes', async (req, res) => {
  try {
    const ctx = await loadContext(req, res);
    if (!ctx) return;
    const subject = clean(ctx.course.subject), title = clean(ctx.course.title);
    const topicList = ctx.topics.map(t => `- ${esc(t.title)}${t.pct !== null ? ` (scored ${t.pct}%)` : ''}`).join('\n');
    const systemPrompt = `You are a concise, expert tutor for ${subject} exam preparation (${title}).
Your task: write focused revision notes for topics a student is struggling with.
Rules:
- For EACH topic, write 3-5 bullet points covering: key definition, the most testable fact, one common exam trap.
- Use plain language suitable for a student preparing for a standardized test.
- Keep each bullet under 20 words.
- Format: ## Topic Name\\n- bullet\\n- bullet\\n...
- Bullets only. No long paragraphs.`;
    const notes = await callClaude(systemPrompt, `Write revision bullets for these topics:\n${topicList}`, 1000);
    res.json({ notes });
  } catch (err) { sendAiError(res, err); }
});

// POST /api/ai/generate-quiz  { courseId, topicIds: [] }
router.post('/generate-quiz', async (req, res) => {
  try {
    const ctx = await loadContext(req, res);
    if (!ctx) return;
    const used = (ctx.student.quizScores || []).filter(q => q.isAIRetry && q.courseId === ctx.course.id).length;
    if (used >= MAX_AI_ATTEMPTS) return res.status(409).json({ message: 'No practice attempts remaining for this course.' });

    const subject = clean(ctx.course.subject), title = clean(ctx.course.title);
    const topicList = ctx.topics.map(t => t.title).join(', ');
    const systemPrompt = `You are a quiz generator for ${subject} (${title}).
Generate exactly 5 multiple-choice questions on these topics: ${topicList}.
CRITICAL: Respond with ONLY a valid JSON array. No preamble, no markdown, no explanation.
Format: [{"q":"Question?","options":["A","B","C","D"],"ans":0,"topicTitle":"Topic name"}]
Rules: ans is the 0-based index of the correct option; exactly 4 plausible options; vary the questions.`;
    const raw = await callClaude(systemPrompt, `Generate 5 fresh MCQ questions on: ${topicList}`, 1200);

    let parsed;
    try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch { parsed = null; }
    const questions = (Array.isArray(parsed) ? parsed : []).map(q => {
      if (!q || typeof q.q !== 'string' || !Array.isArray(q.options) || q.options.length !== 4) return null;
      const options = q.options.map(o => String(o).trim().slice(0, 200));
      const ans = Number(q.ans);
      if (options.some(o => !o) || !Number.isInteger(ans) || ans < 0 || ans > 3) return null;
      return { q: q.q.trim().slice(0, 500), options, ans, topicTitle: clean(q.topicTitle) };
    }).filter(Boolean).slice(0, 10);

    if (questions.length < 3) return res.status(502).json({ message: 'The AI returned an unusable quiz. Please try again.' });
    res.json({ questions });
  } catch (err) { sendAiError(res, err); }
});

module.exports = router;