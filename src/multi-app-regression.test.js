import assert from 'node:assert/strict';
import { getAppConfig, listApps } from './app-registry.js';
import { resolveAppContext } from './app-request.js';

const apps = listApps();
assert.ok(apps.some(({ id }) => id === 'indomark'));
assert.ok(apps.some(({ id }) => id === 'indoone'));

const indoone = resolveAppContext({
  body: { appId: 'indoone' },
  origin: getAppConfig('indoone').url,
});
const indomark = resolveAppContext({
  body: { appId: 'indomark' },
  origin: getAppConfig('indomark').url,
});

assert.equal(indoone.appId, 'indoone');
assert.equal(indomark.appId, 'indomark');
assert.notEqual(indoone.appId, indomark.appId);
assert.notEqual(indoone.app.templateRoot, indomark.app.templateRoot);
assert.notEqual(indoone.app.url, indomark.app.url);

assert.throws(
  () => resolveAppContext({ body: { appId: 'indoone' }, origin: getAppConfig('indomark').url }),
  /origin is not allowed/i,
);

assert.throws(
  () => resolveAppContext({ body: { appId: 'missing-app' }, origin: 'https://example.invalid' }),
  /Unknown application/i,
);

console.log('multi-app regression checks passed');
