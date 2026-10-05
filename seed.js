require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

console.log('DEBUG:', JSON.stringify(process.env.MONGO_URI));

const User = require('./models/User');
const Student = require('./models/Student');
const Teacher = require('./models/Teacher');
const EntryTest = require('./models/EntryTest');
const GradeThreshold = require('./models/GradeThreshold');
const Subject = require('./models/Subject');
const Course = require('./models/Course');
const Batch = require('./models/Batch');
const { seedCounter } = require('./utils/nextId');

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected for seeding.');

  // Wipe existing data so this is safely re-runnable. Comment out any
  // line here if you want to keep existing records on re-seed.
  await Promise.all([
    User.deleteMany({}),
    Student.deleteMany({}),
    Teacher.deleteMany({}),
    EntryTest.deleteMany({}),
    GradeThreshold.deleteMany({}),
    Subject.deleteMany({}),
    Course.deleteMany({}),
    Batch.deleteMany({}),
  ]);

  const hash = (pw) => bcrypt.hash(pw, 10);

  // ── Subjects — the atomic unit everything else references by name ──
  // Every Teacher.subjects entry, EntryTest.subjects entry and Course.subject
  // must match one of these strings exactly (comparisons are case-sensitive).
  await Subject.insertMany([
    { name: 'Biology', isCore: true },
    { name: 'Chemistry', isCore: true },
    { name: 'Physics', isCore: true },
    { name: 'English', isCore: true },
    { name: 'Mathematics', isCore: true },
    { name: 'Economics', isCore: true },
    { name: 'General Knowledge', isCore: true },
  ]);

  // ── Entry tests — from ENTRY_TESTS in app.js §2 ──
  await EntryTest.insertMany([
    { id: 'mdcat', name: 'MDCAT', color: '#1B5FAD', desc: 'Medical & Dental Colleges Admission Test', subjects: ['Biology', 'Chemistry', 'Physics', 'English'] },
    { id: 'ecat',  name: 'ECAT',  color: '#0E8A5F', desc: 'Engineering Colleges Admission Test',      subjects: ['Physics', 'Mathematics', 'Chemistry'] },
    { id: 'bcat',  name: 'BCAT',  color: '#C47C08', desc: 'Business Colleges Admission Test',         subjects: ['Mathematics', 'English', 'Economics'] },
    { id: 'nts',   name: 'NTS',   color: '#7c3aed', desc: 'National Testing Service',                 subjects: ['English', 'Mathematics', 'General Knowledge'] },
  ]);

  // ── Grade thresholds — singleton doc, schema default already matches
  // GRADE_THRESHOLDS in app.js §15, so an empty create() is enough.
  await GradeThreshold.create({});

  // ── Courses ──
  // Course 1 ships with a real week/topic so the student has something to open
  // immediately. Course 2 is deliberately left with an empty curriculum, which
  // is what a freshly admin-created course looks like before its teacher
  // fills it in — useful for testing that state.
  await Course.insertMany([
    {
      id: 1,
      title: 'MDCAT Biology Intensive',
      subject: 'Biology',
      icon: 'B',
      color: '#1B5FAD',
      colorLight: '#EBF2FB',
      teacher: 'T001',
      batchId: 'B001',
      description: 'Complete MDCAT Biology curriculum.',
      weeks: [
        {
          num: 1,
          title: 'Cell Biology',
          uploadedDate: '2026-08-01',
          topics: [
            {
              id: 't1', num: '1.1', title: 'Introduction to the Cell', dueDate: null,
              contents: [
                { type: 'video', label: 'Recorded Lecture', duration: '18:30' },
                { type: 'notes', label: 'Written Notes' },
              ],
            },
            {
              id: 't2', num: '1.2', title: 'Cell Organelles', dueDate: null,
              contents: [
                { type: 'notes', label: 'Written Notes' },
                { type: 'quiz',  label: 'Quiz', questions: [] },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 2,
      title: 'MDCAT Chemistry Foundations',
      subject: 'Chemistry',
      icon: 'C',
      color: '#0E8A5F',
      colorLight: '#E7F5EF',
      teacher: 'T001',
      batchId: 'B001',   
      description: 'Physical and organic chemistry for MDCAT.',
      weeks: [],
    },
  ]);

  // ── Admin ──
  await User.create({
    email: 'admin@mindroute.pk',
    password: await hash('admin1234'),
    role: 'admin',
    name: 'Admin Usman',
  });

  // ── Teacher (User login + Teacher profile) ──
  await User.create({
    email: 'teacher@mindroute.pk',
    password: await hash('teacher1234'),
    role: 'teacher',
    name: 'Ms. Ayesha Noor',
  });
  // Teacher
  await Teacher.create({
    id: 'T001',
    name: 'Ms. Ayesha Noor',
    email: 'teacher@mindroute.pk',
    phone: '0300-1111111',
    subjects: ['Biology', 'Chemistry'],
    status: 'active',
    courseIds: [1, 2],
    joinDate: '2024-08-01',   // was: 'Aug 1, 2024'
  });

  // ── Student (User login + Student profile) ──
  await User.create({
    email: 'student@mindroute.pk',
    password: await hash('student1234'),
    role: 'student',
    name: 'Ali Hassan',
  });
  await Student.create({
    id: 'S001',
    name: 'Ali Hassan',
    rollNo: 'MR-24-MDCAT-001',
    batch: 'MDCAT Alpha 2024',
    entryTest: 'MDCAT',
    email: 'student@mindroute.pk',
    phone: '0300-1234567',
    city: 'Karachi',
    joinDate: '2024-09-01',   // was: 'Sep 1, 2024'
    enrolledCourseIds: [1, 2],
    attendance: 0,
    feeStatus: 'Pending',
    totalFee: 60000,
    paidAmount: 0,
    nextDue: '2024-11-01',    // was: 'Nov 1, 2024'
    attendanceDetail: [],
    quizScores: [],
    assignments: [],
    fees: [],
  });

  // ── Batch — the link that ties student ↔ entry test ↔ teacher ↔ course ──
  // Without a batch, Admin > Batches is empty, getTeacherCourseIds() finds no
  // subject assignment for the teacher, and nothing auto-enrolls.
  await Batch.create({
    id: 'B001',
    name: 'MDCAT Alpha 2024',
    entryTest: 'MDCAT',
    entryTestId: 'mdcat',
    startDate: '2024-09-01',
    status: 'active',
    studentIds: ['S001'],
    // subject name -> teacher.id. Only subjects with a teacher need an entry;
    // Physics and English are intentionally left unassigned so you can see
    // what an incomplete batch looks like in the admin UI.
    subjectTeachers: { Biology: 'T001', Chemistry: 'T001' },
  });

  // Without this, nextId() starts every sequence at 0 and the very first
  // admin-created student/teacher/batch after a fresh seed collides with the
  // S001/T001/B001 rows just inserted above — see utils/nextId.js.
  await seedCounter('student', Student, 'S');
  await seedCounter('teacher', Teacher, 'T');
  await seedCounter('batch', Batch, 'B');


  console.log('\nSeed complete. Login with:');
  console.log('  admin@mindroute.pk   / admin1234');
  console.log('  teacher@mindroute.pk / teacher1234');
  console.log('  student@mindroute.pk / student1234');
  console.log('\nSeeded: 7 subjects, 4 entry tests, 2 courses, 1 batch (B001),');
  console.log('1 teacher (Biology + Chemistry), 1 student enrolled in both courses.');
  console.log('\n(Change these passwords before any real deployment.)');

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
