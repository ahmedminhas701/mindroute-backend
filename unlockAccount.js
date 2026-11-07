#!/usr/bin/env node
require('dotenv').config();
const { unlockAccount, clearAllBuckets } = require('./middleware/rateLimit');

const arg = process.argv[2];
if (!arg) {
  console.log('Usage: node unlockAccount.js <email | --all>');
  console.log('Example: node unlockAccount.js admin@mindroute.pk');
  process.exit(1);
}

if (arg === '--all') {
  const count = clearAllBuckets();
  console.log(`Success: Cleared all ${count} rate limit and lockout bucket(s).`);
} else {
  const cleared = unlockAccount(arg);
  console.log(`Success: Reset ${cleared} lockout bucket(s) for "${arg}".`);
}
process.exit(0);
