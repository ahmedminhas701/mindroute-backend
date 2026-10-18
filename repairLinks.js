require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');
const Batch = require('./models/Batch');
const {
  enrollStudentsInBatchCourses,
  revokeStudentsFromBatchCourses,
  syncBatchCourseTeachers,
} = require('./utils/courseSync');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const batches  = await Batch.find({});
  const students = await Student.find({});
  const batchByName = new Map(batches.map(b => [b.name, b]));
  const studentById = new Map(students.map(s => [s.id, s]));
  const log = [];

  // 1. A student's batch label is the starting truth: make the batch list agree.
  for (const s of students) {
    if (!s.batch) continue;
    const b = batchByName.get(s.batch);
    if (!b) {
      log.push(`${s.id}: label "${esc(s.batch)}" matches no batch; cleared`);
      s.batch = ''; s.entryTest = ''; await s.save();
      continue;
    }
    if (!b.studentIds.includes(s.id)) { b.studentIds.push(s.id); log.push(`${s.id}: added to ${esc(b.name)}`); }
    if (s.entryTest !== b.entryTest) { s.entryTest = b.entryTest; await s.save(); }
  }

  // 2. Clean every batch list: unknown ids, and students who belong to another batch.
  for (const b of batches) {
    const keep = [];
    for (const id of b.studentIds) {
      const s = studentById.get(id);
      if (!s) { log.push(`${esc(b.name)}: removed unknown student ${id}`); continue; }
      if (!s.batch) {
        s.batch = b.name; s.entryTest = b.entryTest; await s.save();
        log.push(`${id}: label set to ${esc(b.name)}`);
        keep.push(id);
        continue;
      }
      if (s.batch !== b.name) {
        await revokeStudentsFromBatchCourses([id], b.id);
        log.push(`${esc(b.name)}: removed ${id} (belongs to ${esc(s.batch)})`);
        continue;
      }
      keep.push(id);
    }
    b.studentIds = [...new Set(keep)];
    await b.save();
  }

  // 3. Enrol everyone in their batch's courses and re-point course teachers.
  for (const b of batches) {
    await enrollStudentsInBatchCourses(b.studentIds, b.id);
    await syncBatchCourseTeachers(b);
  }

  console.log(log.length ? log.join('\n') : 'Everything was already consistent.');
  console.log('Repair complete.');
  await mongoose.disconnect();
})().catch(err => { console.error('Repair failed:', err.message); process.exit(1); });