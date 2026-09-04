import assert from 'node:assert/strict';
import http from 'node:http';

const server = await import('./server-multi-app.js');
assert.ok(server, 'server module should load');

console.log('Indoone OTP backend predeploy smoke test loaded.');
