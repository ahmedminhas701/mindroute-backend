const Counter = require('../models/Counter');

/**
 * Atomically reserve the next id in a named sequence.
 *
 *   await nextId('student', 'S')   // -> 'S006'
 *   await nextId('teacher', 'T')   // -> 'T004'
 *
 * See models/Counter.js for why this replaced `countDocuments() + 1`.
 *
 * seedCounter() must be called after any bulk insert that writes ids directly
 * (seed.js does this), otherwise the counter still sits at 0 and the first id
 * handed out afterwards collides with the seeded data.
 */
async function nextId(sequenceName, prefix, width = 3) {
  const doc = await Counter.findOneAndUpdate(
    { _id: sequenceName },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return prefix + String(doc.seq).padStart(width, '0');
}

/**
 * Fast-forward a sequence so it sits above every id already in a collection.
 * Safe to call repeatedly - it only ever moves the counter up.
 *
 *   await seedCounter('student', Student, 'S')
 */
async function seedCounter(sequenceName, Model, prefix) {
  const docs = await Model.find({}, { id: 1 }).lean();
  let max = 0;
  docs.forEach(d => {
    if (typeof d.id !== 'string' || !d.id.startsWith(prefix)) return;
    const n = parseInt(d.id.slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  const existing = await Counter.findById(sequenceName);
  if (!existing || existing.seq < max) {
    await Counter.findOneAndUpdate(
      { _id: sequenceName },
      { $set: { seq: max } },
      { upsert: true }
    );
  }
  return max;
}

module.exports = { nextId, seedCounter };
