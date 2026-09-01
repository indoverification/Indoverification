import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appRoot, listApps } from './app-registry.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SERVER = fs.readFileSync(path.join(ROOT, 'server-multi-app.js'), 'utf8');
const MAIL = fs.readFileSync(path.join(ROOT, 'mail-service.js'), 'utf8');
const ENTRY = fs.readFileSync(path.join(ROOT, 'entry.js'), 'utf8');

// The shared mail service is the single mail-sending source of truth.
assert.match(SERVER, /import \{ sendMail \} from ['"]\.\/mail-service\.js['"]/);
assert.match(MAIL, /const SENDER_NAME = 'Indoverification'/);
assert.match(MAIL, /const SENDER_EMAIL = 'indogroup@zohomail\.in'/);
assert.match(MAIL, /from:\s*\{ name:\s*SENDER_NAME, address:\s*SENDER_EMAIL \}/);
assert.match(MAIL, /to:\s*recipient/);
assert.doesNotMatch(MAIL, /installSharedMailTransport|globalThis\.fetch/);
assert.doesNotMatch(SERVER, /ZOHO_CLIENT_ID|ZOHO_CLIENT_SECRET|ZOHO_REFRESH_TOKEN|ZOHO_ACCOUNT_ID|ZOHO_MAIL_API_URL|fromAddress|toAddress/);
assert.doesNotMatch(ENTRY, /installSharedMailTransport|smtp-display-name-fallback/);

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

console.log('email sender invariant passed: one shared SMTP transport; global sender; app template/branding isolated');
