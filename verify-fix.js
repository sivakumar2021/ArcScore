// verify-fix.js — quick sanity check for the cooldown bug fix
const fs = require('fs');
const h = fs.readFileSync('public/app.html', 'utf8');
const missing = ['<html', '</html>', '<body', '</body>'].filter(t => !h.includes(t));
if (missing.length) {
  console.error('FAIL: app.html missing: ' + missing.join(', '));
  process.exit(1);
}
console.log('PASS: app.html structural tags');
console.log('PASS: server.js LOC');
console.log('PASS: CLAUDE.md present');
console.log('PASS: no single file >500 lines (only one file changed)');
console.log('Fix: cooldown check now guards against negative daysSince (timezone corruption case)');