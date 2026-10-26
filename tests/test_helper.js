const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

let mongod = null;
process.env.JWT_SECRET = 'test_secret_for_mindroute_backend_1234567890';
process.env.NODE_ENV = 'test';

async function startTestDb() {
  if (!mongod) {
    mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    const uri = mongod.getUri();
    process.env.MONGO_URI = uri;
    await mongoose.connect(uri);
  }
}

async function stopTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}

async function clearTestDb() {
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
      await collections[key].deleteMany({});
    }
  }
}

function makeToken(user) {
  return jwt.sign(
    { id: user._id || user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

module.exports = {
  startTestDb,
  stopTestDb,
  clearTestDb,
  makeToken,
};
