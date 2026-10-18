require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('./models/User');
const Student = require('./models/Student');
const Teacher = require('./models/Teacher');
const EntryTest = require('./models/EntryTest');
const GradeThreshold = require('./models/GradeThreshold');
const Subject = require('./models/Subject');
const Course = require('./models/Course');
const Batch = require('./models/Batch');
const Notification = require('./models/Notification');
const TeacherSchedule = require('./models/TeacherSchedule');
const AttendanceRecord = require('./models/AttendanceRecord');
const Counter = require('./models/Counter');
const { seedCounter } = require('./utils/nextId');

async function seed() {
  // This script WIPES every collection. Never run it against a live database by accident.
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    console.error('Refusing to seed: NODE_ENV is production and this script wipes every collection. Pass --force if you really mean it.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected for seeding.');

  await Promise.all([
    User.deleteMany({}),
    Student.deleteMany({}),
    Teacher.deleteMany({}),
    EntryTest.deleteMany({}),
    GradeThreshold.deleteMany({}),
    Subject.deleteMany({}),
    Course.deleteMany({}),
    Batch.deleteMany({}),
    Notification.deleteMany({}),
    TeacherSchedule.deleteMany({}),
    AttendanceRecord.deleteMany({}),
    Counter.deleteMany({}),
  ]);

  const hash = (pw) => bcrypt.hash(pw, 10);

  // Subjects: every other collection refers to these by exact name.
  await Subject.insertMany([
    { name: 'Biology', isCore: true },
    { name: 'Chemistry', isCore: true },
    { name: 'Physics', isCore: true },
    { name: 'English', isCore: true },
    { name: 'Mathematics', isCore: true },
    { name: 'Economics', isCore: true },
    { name: 'General Knowledge', isCore: true },
  ]);

  await EntryTest.insertMany([
    { id: 'mdcat', name: 'MDCAT', color: '#1B5FAD', desc: 'Medical & Dental Colleges Admission Test', subjects: ['Biology', 'Chemistry', 'Physics', 'English'] },
    { id: 'ecat',  name: 'ECAT',  color: '#0E8A5F', desc: 'Engineering Colleges Admission Test',      subjects: ['Physics', 'Mathematics', 'Chemistry'] },
    { id: 'bcat',  name: 'BCAT',  color: '#C47C08', desc: 'Business Colleges Admission Test',         subjects: ['Mathematics', 'English', 'Economics'] },
    { id: 'nts',   name: 'NTS',   color: '#7c3aed', desc: 'National Testing Service',                 subjects: ['English', 'Mathematics', 'General Knowledge'] },
  ]);

  await GradeThreshold.create({});

  // Course 1 has real content (video slot, notes, a quiz with 2 questions, an assignment).
  // Course 2 is empty, like a freshly created course.
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
                { type: 'video', label: 'Recorded Lecture', url: '', duration: '18:30' },
                { type: 'notes', label: 'Written Notes', url: '' },
              ],
            },
            {
              id: 't2', num: '1.2', title: 'Cell Organelles', dueDate: '2026-12-31',
              contents: [
                { type: 'notes', label: 'Written Notes', url: '' },
                {
                  type: 'quiz', label: 'Quiz',
                  questions: [
                    { q: "Which organelle produces most of the cell's ATP?", options: ['Nucleus', 'Mitochondrion', 'Ribosome', 'Golgi body'], correct: 1, explanation: '' },
                    { q: 'Which organelle is the site of protein synthesis?', options: ['Ribosome', 'Lysosome', 'Vacuole', 'Centriole'], correct: 0, explanation: '' },
                  ],
                },
                { type: 'assign', label: 'Assignment', detail: 'Write a short note on the function of the cell membrane.', totalMarks: 10 },
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

  await User.create({
    email: 'admin@mindroute.pk',
    password: await hash('admin1234'),
    role: 'admin',
    name: 'Admin Usman',
  });

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
    subjects: ['Biology', 'Chemistry'],   // plural: a singular `subject` would be silently discarded
    status: 'active',
    courseIds: [1, 2],
    joinDate: '2024-08-01',
  });

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
    gender: 'Male',
    dob: '2007-05-14',
    guardianName: 'Hassan Raza',
    guardianPhone: '0321-7654321',
    city: 'Karachi',
    joinDate: '2024-09-01',
    enrolledCourseIds: [1, 2],
    attendance: 0,
    feeStatus: 'Pending',
    totalFee: 60000,
    paidAmount: 0,
    nextDue: '2026-11-01',
    attendanceDetail: [],
    quizScores: [],
    assignments: [],
    fees: [
      { label: 'Instalment 1', amount: 30000, dueDate: '2026-11-01', status: 'Pending' },
      { label: 'Instalment 2', amount: 30000, dueDate: '2026-12-01', status: 'Pending' },
    ],
  });

  // Physics and English are intentionally left without a teacher, to show an incomplete batch.
  await Batch.create({
    id: 'B001',
    name: 'MDCAT Alpha 2024',
    entryTest: 'MDCAT',
    entryTestId: 'mdcat',
    startDate: '2024-09-01',
    status: 'active',
    studentIds: ['S001'],
    subjectTeachers: { Biology: 'T001', Chemistry: 'T001' },
  });

  // Without this, the first admin-created student/teacher/batch would collide with S001/T001/B001.
  await seedCounter('student', Student, 'S');
  await seedCounter('teacher', Teacher, 'T');
  await seedCounter('batch', Batch, 'B');

  console.log('\nSeed complete. Login with:');
  console.log('  admin@mindroute.pk   / admin1234');
  console.log('  teacher@mindroute.pk / teacher1234');
  console.log('  student@mindroute.pk / student1234');
  console.log('\nSeeded: 7 subjects, 4 entry tests, 2 courses, 1 batch (B001),');
  console.log('1 teacher (Biology + Chemistry), 1 student enrolled in both courses.');
  console.log('\n(Development data only. Never run this against the client\'s live database.)');

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});