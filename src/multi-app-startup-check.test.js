import assert from 'node:assert/strict';
import { listApps, getAppConfig } from './app-registry.js';

const apps = listApps();
assert.ok(apps.length >= 2, 'expected registered apps');
assert.ok(apps.some((app) => app.id === 'indomark'), 'Indomark must remain registered');
assert.ok(apps.some((app) => app.id === 'indoone'), 'Indoone must be registered');

for (const app of apps) {
  assert.match(app.id, /^[a-z0-9][a-z0-9_-]{1,63}$/);
  assert.ok(app.name, `${app.id}: name is required`);
  assert.ok(app.url, `${app.id}: url is required`);
  assert.ok(app.templateRoot, `${app.id}: templateRoot is required`);
  assert.equal(getAppConfig(app.id).id, app.id);
}

const origins = apps.map((app) => new URL(app.url).origin);
assert.equal(new Set(origins).size, origins.length, 'registered app origins must be unique');

console.log(`multi-app startup checks passed for ${apps.length} apps`);
