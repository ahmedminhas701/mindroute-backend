require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const V = require('./utils/validate');

(async () => {
    const [name, email, password] = process.argv.slice(2);
    const fail = msg => { console.error(msg); process.exit(1); };
    if (!name || !email || !password) fail('Usage: node createAdmin.js "Full Name" email@example.com "StrongPassword"');
    const n = V.normalizePersonName(name, 'Name');
    const e = V.normalizeEmail(email);
    if (!n.ok) fail(n.error);
    if (!e.ok) fail(e.error);
    if (password.length < 8 || password.length > 72) fail('Password must be 8 to 72 characters.');

    await mongoose.connect(process.env.MONGO_URI);
    if (await User.exists({ email: e.value })) fail('That email already has an account.');
    await User.create({ name: n.value, email: e.value, password: await bcrypt.hash(password, 10), role: 'admin' });
    console.log(`Admin created: ${e.value}`);
    await mongoose.disconnect();
})().catch(err => { console.error('Failed:', err.message); process.exit(1); });