const test = require('node:test');
const assert = require('node:assert/strict');
const Notification = require('../../models/Notification');
const { startTestDb, stopTestDb, clearTestDb } = require('../test_helper');

test.before(async () => {
  await startTestDb();
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearTestDb();
});

test('Notification Model - creates valid notification with defaults', async () => {
  const notif = await Notification.create({
    userId: 'user123',
    title: 'Welcome to Mind Route',
  });

  assert.equal(notif.userId, 'user123');
  assert.equal(notif.title, 'Welcome to Mind Route');
  assert.equal(notif.type, 'system');
  assert.equal(notif.read, false);
  assert.equal(notif.body, '');
  assert.ok(notif.createdAt);
  assert.ok(notif.updatedAt);
});

test('Notification Model - requires userId and title', async () => {
  await assert.rejects(
    async () => {
      await Notification.create({ title: 'Only Title' });
    },
    /Path `userId` is required/
  );

  await assert.rejects(
    async () => {
      await Notification.create({ userId: 'user123' });
    },
    /Path `title` is required/
  );
});

test('Notification Model - enforces type enum from Notification.TYPES', async () => {
  assert.ok(Array.isArray(Notification.TYPES));
  assert.ok(Notification.TYPES.includes('assignment'));
  assert.ok(Notification.TYPES.includes('grade'));
  assert.ok(Notification.TYPES.includes('fee'));
  assert.ok(Notification.TYPES.includes('schedule'));

  // Valid enum
  const valid = await Notification.create({
    userId: 'user123',
    title: 'Grade posted',
    type: 'grade',
  });
  assert.equal(valid.type, 'grade');

  // Invalid enum
  await assert.rejects(
    async () => {
      await Notification.create({
        userId: 'user123',
        title: 'Unknown type',
        type: 'invalid_type_xyz',
      });
    },
    /is not a valid enum value for path `type`/
  );
});

test('Notification Model - enforces title maxlength 120', async () => {
  const longTitle = 'A'.repeat(121);
  await assert.rejects(
    async () => {
      await Notification.create({
        userId: 'user123',
        title: longTitle,
      });
    },
    /longer than the maximum allowed length/
  );
});

test('Notification Model - indexes check', async () => {
  const indexes = Notification.schema.indexes();
  // index on { userId: 1, createdAt: -1 }
  const userCreatedIdx = indexes.find(idx => idx[0].userId === 1 && idx[0].createdAt === -1);
  assert.ok(userCreatedIdx, 'Index on userId and createdAt should exist');

  // TTL index on createdAt with expireAfterSeconds
  const ttlIdx = indexes.find(idx => idx[0].createdAt === 1 && idx[1] && idx[1].expireAfterSeconds === 60 * 24 * 60 * 60);
  assert.ok(ttlIdx, 'TTL index with 60 days expireAfterSeconds should exist');
});
