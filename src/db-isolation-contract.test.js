import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./server-multi-app.js', import.meta.url), 'utf8');

assert.match(source, /CREATE TABLE IF NOT EXISTS otp_codes[\s\S]*?app_id TEXT NOT NULL/);
assert.match(source, /CREATE TABLE IF NOT EXISTS signup_welcome_tokens[\s\S]*?app_id TEXT NOT NULL/);
assert.match(source, /WHERE app_id=\$1 AND email=\$2 AND purpose=\$3/);
assert.match(source, /DELETE FROM otp_codes WHERE app_id=\$1 AND email=\$2 AND purpose=\$3/);
assert.match(source, /signup_welcome_tokens.*app_id/i);

console.log('database app-isolation contract checks passed');
