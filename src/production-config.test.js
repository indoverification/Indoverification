import assert from 'node:assert/strict';
import { getAppConfig, listApps } from './app-registry.js';

const apps = listApps();
assert.ok(apps.length >= 2, 'Expected at least the baseline apps.');

for (const id of ['indomark', 'indoone']) {
  const app = getAppConfig(id);
  assert.equal(app.id, id);
  assert.ok(app.url, `${id} must define an app URL.`);
  assert.ok(app.templateRoot, `${id} must define a template root.`);
}

const origins = apps
  .map((app) => new URL(app.url).origin)
  .filter(Boolean);
assert.equal(new Set(origins).size, origins.length, 'App origins must be unique.');

console.log('production app configuration checks passed');
