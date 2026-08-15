const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');

/**
 * Creates the login (User) record that goes alongside a Student or
 * Teacher profile. If no password is supplied, generates a random
 * temp password and returns it once (plaintext) so the caller can
 * hand it to the admin to share — it is never stored or returned again.
 *
 * Throws on failure (e.g. duplicate email) so the caller can roll back
 * the profile record it just created.
 */
async function createUserAccount({ name, email, role, password }) {
  const plainPassword = password || crypto.randomBytes(4).toString('hex'); // e.g. 'a1b2c3d4'
  const hashed = await bcrypt.hash(plainPassword, 10);

  const user = await User.create({
    name,
    email: email.toLowerCase().trim(),
    role,
    password: hashed,
  });

  return { user, tempPassword: password ? null : plainPassword };
}

module.exports = createUserAccount;
