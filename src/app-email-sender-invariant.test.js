import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appRoot, listApps } from './app-registry.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SERVER = fs.readFileSync(path.join(ROOT, 'server-multi-app.js'), 'utf8');

// The provider sender is global and must never be selected from an app manifest.
assert.match(SERVER, /const ZOHO_FROM = String\(process\.env\.ZOHO_FROM/);
assert.match(SERVER, /fromAddress:\s*sender/);
assert.doesNotMatch(SERVER, /fromAddress:\s*.*brand|fromAddress:\s*.*app/i);

// Every registered app owns branding/template metadata independently.
for (const app of listApps()) {
  const manifestPath = path.join(appRoot(app.id), 'email-templates.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.appId, app.id);
  assert.ok(manifest.templates?.signupOtp);
  assert.ok(manifest.templates?.loginOtp);
  assert.ok(manifest.templates?.welcome);
  assert.ok(manifest.branding?.name);
  assert.ok(manifest.branding?.primaryColor);
}

console.log('email sender invariant passed: provider sender is global; app template/branding is isolated');
