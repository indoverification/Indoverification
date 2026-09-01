import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const here = new URL('.', import.meta.url);
const srcRoot = path.dirname(here.pathname);

assert.equal(fs.existsSync(path.join(srcRoot, 'entry.js')), true, 'runtime entrypoint must exist');
assert.equal(fs.existsSync(path.join(srcRoot, 'server.js')), true, 'server compatibility entrypoint must exist');
assert.equal(fs.existsSync(path.join(srcRoot, 'server-multi-app.js')), true, 'multi-app runtime must exist');

const entry = fs.readFileSync(path.join(srcRoot, 'entry.js'), 'utf8');
const server = fs.readFileSync(path.join(srcRoot, 'server.js'), 'utf8');

assert.match(entry, /import\('\.\/server\.js'\)/, 'entrypoint must load server.js');
assert.match(server, /import\('\.\/server-multi-app\.js'\)/, 'server.js must load multi-app runtime');

console.log('predeploy runtime contract checks passed');
