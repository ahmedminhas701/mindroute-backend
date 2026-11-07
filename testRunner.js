const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findTestFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

const testsDir = path.join(__dirname, 'tests');
const testFiles = findTestFiles(testsDir);

console.log(`Found ${testFiles.length} test files. Running test suite...\n`);

let passedCount = 0;
let failedCount = 0;
const failures = [];

for (const file of testFiles) {
  const relPath = path.relative(__dirname, file);
  process.stdout.write(`• Running ${relPath} ... `);
  const res = spawnSync(process.execPath, [file], {
    cwd: __dirname,
    stdio: 'pipe',
    encoding: 'utf8',
    env: process.env,
  });

  if (res.status === 0) {
    console.log('\x1b[32mPASS\x1b[0m');
    passedCount++;
  } else {
    console.log('\x1b[31mFAIL\x1b[0m');
    failedCount++;
    failures.push({ file: relPath, stdout: res.stdout, stderr: res.stderr });
  }
}

console.log('\n========================================');
console.log(`Test Results: ${passedCount} passed, ${failedCount} failed out of ${testFiles.length} test suites.`);
console.log('========================================\n');

if (failedCount > 0) {
  for (const f of failures) {
    console.error(`\n--- Failure in ${f.file} ---`);
    if (f.stdout) console.error(f.stdout);
    if (f.stderr) console.error(f.stderr);
  }
  process.exit(1);
} else {
  console.log('\x1b[32mAll test suites passed successfully!\x1b[0m\n');
  process.exit(0);
}
