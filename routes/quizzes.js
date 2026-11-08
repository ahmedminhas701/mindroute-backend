const express = require('express');
const router = express.Router();

const Quiz = require('../models/Quiz');
const Course = require('../models/Course');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const { protect, restrictTo } = require('../middleware/auth');
const { notifyStudents } = require('../utils/notify');

router.use(protect);

// Helper: Check if teacher or admin owns this course
async function mayManageQuiz(req, res, courseId) {
  if (req.user.role === 'admin') return true;
  const teacher = await Teacher.findOne({ email: req.user.email });
  if (!teacher) {
    res.status(403).json({ message: 'No teacher profile linked to your account.' });
    return false;
  }
  const course = await Course.findOne({ id: courseId });
  if (!course) {
    res.status(404).json({ message: 'Course not found.' });
    return false;
  }
  if (course.teacher === teacher.id || (teacher.courseIds || []).includes(course.id)) return true;
  res.status(403).json({ message: 'You can only manage quizzes for courses you teach.' });
  return false;
}

// GET /api/quizzes - list quizzes
router.get('/', async (req, res) => {
  try {
    const courseId = req.query.courseId ? Number(req.query.courseId) : null;

    if (req.user.role === 'student') {
      const student = await Student.findOne({ email: req.user.email }).lean();
      if (!student) return res.status(404).json({ message: 'Student record not found.' });

      const courseFilter = courseId ? [courseId] : (student.enrolledCourseIds || []);
      const quizzes = await Quiz.find({
        courseId: { $in: courseFilter },
        published: true,
      }).sort({ createdAt: -1 }).lean();

      // Mask correct answers and attach student's previous score if any
      const sanitized = quizzes.map(quiz => {
        const existingScore = (student.quizScores || []).find(q =>
          q.topicId === `quiz-${quiz._id}` || q.id === `quiz-${quiz._id}`
        );
        const questions = (quiz.questions || []).map(q => ({
          _id: q._id,
          q: q.q,
          options: q.options,
          // Hide correct index from active quizzes
          correct: existingScore ? q.correct : undefined,
          explanation: existingScore ? q.explanation : undefined,
        }));

        return {
          _id: quiz._id,
          title: quiz.title,
          courseId: quiz.courseId,
          batchId: quiz.batchId,
          timeLimit: quiz.timeLimit,
          dueDate: quiz.dueDate,
          published: quiz.published,
          questionCount: questions.length,
          questions,
          userAttempt: existingScore ? {
            score: existingScore.score,
            total: existingScore.total,
            date: existingScore.date,
            attemptNum: existingScore.attemptNum || 1,
          } : null,
        };
      });

      return res.json(sanitized);
    }

    // Teacher or Admin
    const query = {};
    if (courseId) query.courseId = courseId;
    if (req.user.role === 'teacher') {
      const teacher = await Teacher.findOne({ email: req.user.email }).lean();
      if (!teacher) return res.status(403).json({ message: 'No teacher profile found.' });
      query.courseId = { $in: teacher.courseIds || [] };
      if (courseId && !teacher.courseIds.includes(courseId)) {
        return res.status(403).json({ message: 'You do not teach this course.' });
      }
    }

    const list = await Quiz.find(query).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    console.error('GET /api/quizzes failed:', err);
    res.status(500).json({ message: 'Failed to load quizzes.' });
  }
});

// GET /api/quizzes/:id
router.get('/:id', async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).lean();
    if (!quiz) return res.status(404).json({ message: 'Quiz not found.' });

    if (req.user.role === 'student') {
      const student = await Student.findOne({ email: req.user.email }).lean();
      if (!student || !(student.enrolledCourseIds || []).includes(quiz.courseId)) {
        return res.status(403).json({ message: 'You are not enrolled in this course.' });
      }
      if (!quiz.published) {
        return res.status(404).json({ message: 'This quiz is not currently available.' });
      }

      const existingScore = (student.quizScores || []).find(q =>
        q.topicId === `quiz-${quiz._id}` || q.id === `quiz-${quiz._id}`
      );

      const sanitizedQuestions = (quiz.questions || []).map(q => ({
        _id: q._id,
        q: q.q,
        options: q.options,
        correct: existingScore ? q.correct : undefined,
        explanation: existingScore ? q.explanation : undefined,
      }));

      return res.json({
        ...quiz,
        questions: sanitizedQuestions,
        userAttempt: existingScore || null,
      });
    }

    res.json(quiz);
  } catch (err) {
    console.error('GET /api/quizzes/:id failed:', err);
    res.status(500).json({ message: 'Failed to load quiz.' });
  }
});

// POST /api/quizzes - create new quiz
router.post('/', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const { title, courseId, batchId, timeLimit, dueDate, published, questions } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ message: 'Quiz title is required.' });
    }
    const cid = Number(courseId);
    if (!cid || isNaN(cid)) {
      return res.status(400).json({ message: 'Valid course ID is required.' });
    }
    if (!(await mayManageQuiz(req, res, cid))) return;

    const course = await Course.findOne({ id: cid });
    if (!course) return res.status(404).json({ message: 'Course not found.' });

    const qList = Array.isArray(questions) ? questions : [];
    if (!qList.length) {
      return res.status(400).json({ message: 'Quiz must have at least one question.' });
    }

    const cleanQuestions = [];
    for (let i = 0; i < qList.length; i++) {
      const q = qList[i] || {};
      const qText = String(q.q || '').trim();
      if (!qText) return res.status(400).json({ message: `Question ${i + 1} has no text.` });
      const options = Array.isArray(q.options) ? q.options.map(o => String(o).trim()).filter(Boolean) : [];
      if (options.length < 2) return res.status(400).json({ message: `Question ${i + 1} must have at least 2 options.` });
      const correct = Number(q.correct);
      if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
        return res.status(400).json({ message: `Question ${i + 1} must have a valid correct option selected.` });
      }
      cleanQuestions.push({
        q: qText,
        options,
        correct,
        explanation: String(q.explanation || '').trim(),
      });
    }

    const teacher = req.user.role === 'teacher' ? await Teacher.findOne({ email: req.user.email }).lean() : null;

    const quiz = await Quiz.create({
      title: String(title).trim(),
      courseId: cid,
      batchId: batchId || course.batchId || '',
      teacherId: teacher ? teacher.id : (course.teacher || ''),
      timeLimit: typeof timeLimit === 'number' ? Math.max(0, timeLimit) : 15,
      dueDate: dueDate || '',
      published: !!published,
      questions: cleanQuestions,
    });

    if (quiz.published) {
      const students = await Student.find({ enrolledCourseIds: cid }, { id: 1 }).lean();
      await notifyStudents(students.map(s => s.id), {
        type: 'quiz',
        title: `New Quiz: ${quiz.title}`,
        body: `A new quiz has been published for ${course.title}. ${quiz.dueDate ? 'Due: ' + quiz.dueDate : ''}`,
      });
    }

    res.status(201).json(quiz);
  } catch (err) {
    console.error('POST /api/quizzes failed:', err);
    res.status(400).json({ message: err.message || 'Failed to create quiz.' });
  }
});

// PUT /api/quizzes/:id - update quiz
router.put('/:id', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found.' });
    if (!(await mayManageQuiz(req, res, quiz.courseId))) return;

    const { title, timeLimit, dueDate, published, questions, batchId } = req.body;
    if (title) quiz.title = String(title).trim();
    if (typeof timeLimit === 'number') quiz.timeLimit = Math.max(0, timeLimit);
    if (dueDate !== undefined) quiz.dueDate = dueDate || '';
    if (batchId !== undefined) quiz.batchId = batchId || '';

    const wasPublished = quiz.published;
    if (typeof published === 'boolean') quiz.published = published;

    if (Array.isArray(questions)) {
      if (!questions.length) return res.status(400).json({ message: 'Quiz must have at least one question.' });
      const cleanQuestions = [];
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i] || {};
        const qText = String(q.q || '').trim();
        if (!qText) return res.status(400).json({ message: `Question ${i + 1} has no text.` });
        const options = Array.isArray(q.options) ? q.options.map(o => String(o).trim()).filter(Boolean) : [];
        if (options.length < 2) return res.status(400).json({ message: `Question ${i + 1} must have at least 2 options.` });
        const correct = Number(q.correct);
        if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
          return res.status(400).json({ message: `Question ${i + 1} must have a valid correct option selected.` });
        }
        cleanQuestions.push({
          q: qText,
          options,
          correct,
          explanation: String(q.explanation || '').trim(),
        });
      }
      quiz.questions = cleanQuestions;
    }

    await quiz.save();

    if (!wasPublished && quiz.published) {
      const course = await Course.findOne({ id: quiz.courseId }).lean();
      const students = await Student.find({ enrolledCourseIds: quiz.courseId }, { id: 1 }).lean();
      await notifyStudents(students.map(s => s.id), {
        type: 'quiz',
        title: `Quiz Published: ${quiz.title}`,
        body: `A quiz is now available for ${course ? course.title : 'your course'}.`,
      });
    }

    res.json(quiz);
  } catch (err) {
    console.error('PUT /api/quizzes/:id failed:', err);
    res.status(400).json({ message: err.message || 'Failed to update quiz.' });
  }
});

// DELETE /api/quizzes/:id
router.delete('/:id', restrictTo('admin', 'teacher'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found.' });
    if (!(await mayManageQuiz(req, res, quiz.courseId))) return;

    await Quiz.deleteOne({ _id: quiz._id });
    res.json({ message: 'Quiz deleted successfully.' });
  } catch (err) {
    console.error('DELETE /api/quizzes/:id failed:', err);
    res.status(500).json({ message: 'Failed to delete quiz.' });
  }
});

// POST /api/quizzes/:id/attempt - student submits quiz attempt
router.post('/:id/attempt', restrictTo('student'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz || !quiz.published) {
      return res.status(404).json({ message: 'Quiz not found or not currently available.' });
    }

    const student = await Student.findOne({ email: req.user.email });
    if (!student || !(student.enrolledCourseIds || []).includes(quiz.courseId)) {
      return res.status(403).json({ message: 'You are not enrolled in this course.' });
    }

    const course = await Course.findOne({ id: quiz.courseId }).lean();

    const questions = quiz.questions || [];
    let answers = [];
    if (Array.isArray(req.body.answers)) {
      answers = req.body.answers;
    } else if (req.body.answers && typeof req.body.answers === 'object') {
      const obj = req.body.answers;
      answers = questions.map((_, i) => obj[i] !== undefined ? obj[i] : obj[String(i)]);
    }

    let score = 0;
    const correctAnswers = [];
    const explanations = [];

    questions.forEach((q, i) => {
      correctAnswers.push(q.correct);
      explanations.push(q.explanation || '');
      if (answers[i] !== undefined && Number(answers[i]) === q.correct) {
        score += 1;
      }
    });

    const total = questions.length;
    const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

    // Save or update score in student.quizScores
    const quizScoreId = `quiz-${quiz._id}`;
    const existingIndex = (student.quizScores || []).findIndex(s => s.topicId === quizScoreId || s.id === quizScoreId);
    const attemptNum = existingIndex !== -1 ? (student.quizScores[existingIndex].attemptNum || 1) + 1 : 1;

    const scoreEntry = {
      id: quizScoreId,
      topicId: quizScoreId,
      topic: quiz.title,
      subject: course ? course.subject : 'General',
      score,
      total,
      date: new Date().toISOString().slice(0, 10),
      courseId: quiz.courseId,
      isAIRetry: false,
      attemptNum,
      feedback: `Completed with ${score}/${total} (${percentage}%)`,
    };

    if (existingIndex !== -1) {
      student.quizScores[existingIndex] = scoreEntry;
    } else {
      student.quizScores.push(scoreEntry);
    }

    await student.save();

    res.json({
      score,
      total,
      pct: percentage,
      percentage,
      passed: percentage >= 50,
      correctAnswers,
      explanations,
      attemptNum,
    });
  } catch (err) {
    console.error('POST /api/quizzes/:id/attempt failed:', err);
    res.status(500).json({ message: 'Failed to record quiz attempt.' });
  }
});

module.exports = router;
