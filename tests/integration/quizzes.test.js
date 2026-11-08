const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../server');
const User = require('../../models/User');
const Teacher = require('../../models/Teacher');
const Student = require('../../models/Student');
const Course = require('../../models/Course');
const Quiz = require('../../models/Quiz');
const { startTestDb, stopTestDb, clearTestDb, makeToken } = require('../test_helper');

let teacherUser, teacherToken, studentUser, studentToken;
let course, student;

test.before(async () => {
  await startTestDb();
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearTestDb();

  teacherUser = await User.create({
    name: 'Dr. Ahmad',
    email: 'ahmad@mindroute.com',
    role: 'teacher',
    password: 'Password123!',
  });
  teacherToken = makeToken(teacherUser);

  await Teacher.create({
    id: 'T101',
    name: 'Dr. Ahmad',
    email: 'ahmad@mindroute.com',
    phone: '0300-1112233',
    subjects: ['Biology'],
    status: 'active',
  });

  studentUser = await User.create({
    name: 'Bilal Khan',
    email: 'bilal@mindroute.com',
    role: 'student',
    password: 'Password123!',
  });
  studentToken = makeToken(studentUser);

  student = await Student.create({
    id: 'S101',
    name: 'Bilal Khan',
    rollNo: 'MR-26MDCAT-001',
    email: 'bilal@mindroute.com',
    phone: '0311-2223344',
    guardianName: 'Tariq Khan',
    guardianPhone: '0322-3334455',
    gender: 'Male',
    city: 'Lahore',
    enrolledCourseIds: [1],
    quizScores: [],
  });

  course = await Course.create({
    id: 1,
    title: 'Cell Biology',
    subject: 'Biology',
    teacher: 'T101',
    batchId: 'B-01',
    weeks: [],
  });
});

test('Integration - Teacher can create and update a quiz, student cannot create', async () => {
  // Student attempted creation -> 403 Forbidden
  const forbiddenRes = await request(app)
    .post('/api/quizzes')
    .set('Authorization', `Bearer ${studentToken}`)
    .send({
      title: 'Chapter 1 MCQ Quiz',
      courseId: 1,
      timeLimit: 15,
      questions: [
        { q: 'What is the powerhouse of the cell?', options: ['Ribosome', 'Mitochondria', 'Nucleus'], correct: 1 },
      ],
    });
  assert.equal(forbiddenRes.status, 403);

  // Teacher creation -> 201 Created
  const createRes = await request(app)
    .post('/api/quizzes')
    .set('Authorization', `Bearer ${teacherToken}`)
    .send({
      title: 'Chapter 1 Cell Structure Quiz',
      courseId: 1,
      timeLimit: 15,
      dueDate: '2026-11-20',
      published: true,
      questions: [
        {
          q: 'Which organelle contains genetic material?',
          options: ['Ribosome', 'Mitochondria', 'Nucleus', 'Golgi Body'],
          correct: 2,
          explanation: 'The nucleus encloses eukaryotic DNA.',
        },
        {
          q: 'Which cell structure synthesizes proteins?',
          options: ['Ribosome', 'Vacuole', 'Centriole', 'Lysosome'],
          correct: 0,
          explanation: 'Ribosomes translate mRNA into polypeptide chains.',
        },
      ],
    });

  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.title, 'Chapter 1 Cell Structure Quiz');
  assert.equal(createRes.body.questions.length, 2);
  const quizId = createRes.body._id;

  // Teacher updates quiz
  const updateRes = await request(app)
    .put(`/api/quizzes/${quizId}`)
    .set('Authorization', `Bearer ${teacherToken}`)
    .send({
      title: 'Chapter 1 Cell Structure Quiz (Updated)',
      timeLimit: 20,
    });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.title, 'Chapter 1 Cell Structure Quiz (Updated)');
  assert.equal(updateRes.body.timeLimit, 20);
});

test('Integration - Student attempts quiz, gets auto-graded score saved to student record', async () => {
  const quiz = await Quiz.create({
    title: 'Cell Organelles Pop Quiz',
    courseId: 1,
    teacherId: 'T101',
    timeLimit: 10,
    published: true,
    questions: [
      {
        q: 'What is the function of mitochondria?',
        options: ['Photosynthesis', 'ATP Generation', 'Protein Folding'],
        correct: 1,
        explanation: 'Generates ATP via cellular respiration.',
      },
      {
        q: 'Which organelle carries out photosynthesis?',
        options: ['Chloroplast', 'Ribosome', 'Endoplasmic Reticulum'],
        correct: 0,
        explanation: 'Chloroplasts absorb sunlight to produce glucose.',
      },
    ],
  });

  // Student fetches quiz: correct answers must be masked!
  const getRes = await request(app)
    .get(`/api/quizzes/${quiz._id}`)
    .set('Authorization', `Bearer ${studentToken}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.title, 'Cell Organelles Pop Quiz');
  assert.equal(getRes.body.questions[0].correct, undefined); // Masked for student!

  // Student submits answers: 1st correct (option 1), 2nd wrong (option 1 instead of 0)
  const attemptRes = await request(app)
    .post(`/api/quizzes/${quiz._id}/attempt`)
    .set('Authorization', `Bearer ${studentToken}`)
    .send({
      answers: {
        0: 1, // correct
        1: 1, // wrong
      },
    });

  assert.equal(attemptRes.status, 200);
  assert.equal(attemptRes.body.score, 1);
  assert.equal(attemptRes.body.total, 2);
  assert.equal(attemptRes.body.percentage, 50);
  assert.equal(attemptRes.body.correctAnswers[0], 1);
  assert.equal(attemptRes.body.correctAnswers[1], 0);

  // Verify score saved in Student record
  const studentInDb = await Student.findOne({ email: 'bilal@mindroute.com' });
  assert.ok(studentInDb.quizScores.length >= 1);
  const recorded = studentInDb.quizScores[studentInDb.quizScores.length - 1];
  assert.equal(recorded.score, 1);
  assert.equal(recorded.total, 2);
  assert.equal(recorded.topic, 'Cell Organelles Pop Quiz');
});
