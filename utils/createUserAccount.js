const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');

function generatePassword() { return crypto.randomBytes(5).toString('hex'); }   // e.g. 'a1b2c3d4e5'

/**
 * Creates the login record that goes with a Student/Teacher profile. If no
 * password is supplied, generates one and returns it once.
 * Throws on failure (e.g. duplicate email) so the caller can roll back.
 */
async function createUserAccount({ name, email, role, password }) {
  const plain = password || generatePassword();
  const user = await User.create({
    name,
    email: email.toLowerCase().trim(),
    role,
    password: await bcrypt.hash(plain, 10),
  });
  return { user, tempPassword: password ? null : plain };
}

/** Sets a fresh temporary password on an existing login. */
async function resetPassword(email) {
  const plain = generatePassword();
  const result = await User.updateOne(
    { email: String(email).toLowerCase().trim() },
    { $set: { password: await bcrypt.hash(plain, 10) } }
  );
  if (!result.matchedCount) throw new Error('No login account exists for that email.');
  return { tempPassword: plain };
}

module.exports = createUserAccount;
module.exports.resetPassword = resetPassword;