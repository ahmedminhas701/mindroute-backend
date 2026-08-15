const express = require('express');
const router = express.Router();

const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

// This is the fix for the #1 flagged issue in TECHNICAL_REFERENCE.md §8/§11.3:
// app.js's callClaude() hit https://api.anthropic.com/v1/messages directly
// from the browser with no API key attached. That call moves here — the key
// lives only in process.env.ANTHROPIC_API_KEY, server-side, never shipped
// to the client.
async function callClaude(systemPrompt, userMessage, maxTokens = 1000) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }
  const data = await response.json();
  return data.content?.[0]?.text || '';
}

// POST /api/ai/study-notes
// body: { course: { subject, title }, weakTopics: [{ title, pct }] }
// Mirrors generateStudyNotes() (app.js §23) exactly, prompt included.
router.post('/study-notes', restrictTo('student'), async (req, res) => {
  try {
    const { course, weakTopics } = req.body;
    if (!course?.subject || !Array.isArray(weakTopics) || !weakTopics.length) {
      return res.status(400).json({ message: 'course and weakTopics are required.' });
    }

    const topicList = weakTopics.map(t => `- ${t.title} (scored ${t.pct}%)`).join('\n');
    const systemPrompt = `You are a concise, expert tutor for ${course.subject} exam preparation (${course.title}).
Your task: write focused revision notes for topics a student is struggling with.
Rules:
- For EACH topic, write 3-5 bullet points covering: key definition, the most testable fact, one common exam trap.
- Use plain language suitable for a student preparing for a standardized test.
- Keep each bullet under 20 words.
- Format: ## Topic Name\\n• bullet\\n• bullet\\n...
- Do not write lengthy paragraphs. Bullets only.`;
    const userMessage = `The student scored below 70% on these topics:\n${topicList}\n\nWrite revision bullets for each one.`;

    const notes = await callClaude(systemPrompt, userMessage, 1000);
    res.json({ notes });
  } catch (err) {
    res.status(502).json({ message: 'Failed to generate study notes.', error: err.message });
  }
});

// POST /api/ai/generate-quiz
// body: { course: { subject, title }, weakTopics: [{ title }], numQuestions? }
// Mirrors generateQuizQuestions() (app.js §23). The "strict JSON only" system
// prompt instruction must stay intact — the parser below has no fallback
// if the model adds commentary around the array.
router.post('/generate-quiz', restrictTo('student'), async (req, res) => {
  try {
    const { course, weakTopics, numQuestions = 5 } = req.body;
    if (!course?.subject || !Array.isArray(weakTopics) || !weakTopics.length) {
      return res.status(400).json({ message: 'course and weakTopics are required.' });
    }

    const topicList = weakTopics.map(t => t.title).join(', ');
    const systemPrompt = `You are a quiz generator for ${course.subject} (${course.title}).
Generate exactly ${numQuestions} multiple-choice questions targeting these weak topics: ${topicList}.
CRITICAL: Respond with ONLY a valid JSON array. No preamble, no markdown, no explanation. Just the raw JSON array.
Format:
[
  {
    "q": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "ans": 0,
    "topicTitle": "Topic name"
  }
]
Rules:
- ans is the 0-based index of the correct option
- All 4 options must be plausible (no obviously wrong distractors)
- Questions must be different from previous attempts
- Focus on concepts the student got wrong`;
    const userMessage = `Generate ${numQuestions} fresh MCQ questions for these weak topics: ${topicList}`;

    const raw = await callClaude(systemPrompt, userMessage, 1200);
    const clean = raw.replace(/```json|```/g, '').trim();

    let questions;
    try {
      questions = JSON.parse(clean);
    } catch {
      return res.status(502).json({ message: 'AI returned an unparseable quiz format.' });
    }
    if (!Array.isArray(questions) || !questions.length) {
      return res.status(502).json({ message: 'Invalid quiz format from AI.' });
    }

    res.json({ questions });
  } catch (err) {
    res.status(502).json({ message: 'Failed to generate quiz.', error: err.message });
  }
});

module.exports = router;