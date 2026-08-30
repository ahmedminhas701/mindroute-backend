require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

require('dotenv').config();
console.log('DEBUG:', JSON.stringify(process.env.MONGO_URI));

const User = require('./models/User');
const Student = require('./models/Student');
const Teacher = require('./models/Teacher');
const EntryTest = require('./models/EntryTest');
const GradeThreshold = require('./models/GradeThreshold');

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
  ]);

  const hash = (pw) => bcrypt.hash(pw, 10);

  // ── Entry tests — from ENTRY_TESTS in app.js §2 ──
  await EntryTest.insertMany([
    { id: 'mdcat', name: 'MDCAT', color: '#1B5FAD', desc: 'Medical & Dental Colleges Admission Test', subjects: ['Biology', 'Chemistry', 'Physics', 'English'] },
    { id: 'ecat',  name: 'ECAT',  color: '#0E8A5F', desc: 'Engineering Colleges Admission Test',      subjects: ['Physics', 'Mathematics', 'Chemistry'] },
    { id: 'bcat',  name: 'BCAT',  color: '#C47C08', desc: 'Business Colleges Admission Test',         subjects: ['Mathematics', 'English', 'Economics'] },
    { id: 'nts',   name: 'NTS',   color: '#7c3aed', desc: 'National Testing Service',                 subjects: ['English', 'Mathematics', 'General Knowledge'] },
  ]);

  
  const Subject = require('./models/Subject');
  await Subject.deleteMany({});
  await Subject.insertMany([
    { name: 'Biology', isCore: true },
    { name: 'Chemistry', isCore: true },
    { name: 'Physics', isCore: true },
    { name: 'English', isCore: true },
    { name: 'Mathematics', isCore: true },
    { name: 'Economics', isCore: true },
    { name: 'General Knowledge', isCore: true },
  ]);

  // ── Grade thresholds — singleton doc, schema default already matches
  // GRADE_THRESHOLDS in app.js §15, so an empty create() is enough.
  await GradeThreshold.create({});

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
  await Teacher.create({
    id: 'T001',
    name: 'Ms. Ayesha Noor',
    email: 'teacher@mindroute.pk',
    phone: '0300-1111111',
    subject: ['Biology'],
    status: 'active',
    courseIds: [],
    joinDate: 'Aug 1, 2024',
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
    joinDate: 'Sep 1, 2024',
    enrolledCourseIds: [],
    attendance: 0,
    feeStatus: 'Unpaid',
    totalFee: 60000,
    paidAmount: 0,
    nextDue: 'Nov 1, 2024',
    attendanceDetail: [],
    quizScores: [],
    assignments: [],
    fees: [],
  });

  const Course = require('./models/Course');
  await Course.deleteMany({});
  await Course.create({
    id: 1,
    title: 'MDCAT Biology Intensive',
    subject: 'Biology',
    icon: 'B',
    color: '#1B5FAD',
    colorLight: '#EBF2FB',
    teacher: 'Ms. Ayesha Noor',
    description: 'Complete MDCAT Biology curriculum.',
    weeks: [
      {
        num: 1,
        title: 'Cell Biology',
        uploadedDate: 'Aug 1, 2026',
        topics: [
          {
            id: 't1', num: '1.1', title: 'Introduction to the Cell', dueDate: null,
            contents: [
              { type: 'video', label: 'Recorded Lecture', duration: '18:30' },
              { type: 'notes', label: 'Written Notes' },
            ],
          },
        ],
      },
    ],
  });

  console.log('\nSeed complete. Login with:');
  console.log('  admin@mindroute.pk   / admin1234');
  console.log('  teacher@mindroute.pk / teacher1234');
  console.log('  student@mindroute.pk / student1234');
  console.log('\n(Change these passwords before any real deployment.)');

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
