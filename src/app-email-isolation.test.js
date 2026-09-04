import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { listApps, appRoot } from './app-registry.js';

for (const app of listApps()) {
  const root = appRoot(app.id);
  const manifestPath = path.join(root, 'email-templates.json');
  assert.equal(fs.existsSync(manifestPath), true, `${app.id}: missing email template manifest`);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.appId, app.id, `${app.id}: email manifest appId mismatch`);
  assert.ok(manifest.templates?.signupOtp, `${app.id}: signup OTP template missing`);
  assert.ok(manifest.templates?.loginOtp, `${app.id}: login OTP template missing`);
  assert.ok(manifest.templates?.welcome, `${app.id}: welcome template missing`);
  assert.ok(manifest.templates?.welcomeBack, `${app.id}: welcome-back template missing`);
  assert.equal(manifest.branding?.name, app.name, `${app.id}: branding name mismatch`);
  assert.ok(manifest.branding?.primaryColor, `${app.id}: primary color missing`);

  for (const [key, templateName] of Object.entries(manifest.templates || {})) {
    assert.match(String(templateName), /^[a-z0-9][a-z0-9_-]*$/i, `${app.id}: invalid template mapping for ${key}`);
    const templatePath = path.join(root, 'templates', `${templateName}.html`);
    assert.equal(fs.existsSync(templatePath), true, `${app.id}: missing template file ${templateName}.html`);
  }
}

const indoone = JSON.parse(fs.readFileSync(path.join(appRoot('indoone'), 'email-templates.json'), 'utf8'));
const indomark = JSON.parse(fs.readFileSync(path.join(appRoot('indomark'), 'email-templates.json'), 'utf8'));
assert.notEqual(indoone.branding.name, indomark.branding.name);
assert.notEqual(indoone.branding.primaryColor, indomark.branding.primaryColor);

console.log('app-email isolation checks passed');
