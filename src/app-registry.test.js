import assert from 'node:assert/strict';
import { getAppConfig, hasApp, listApps } from './app-registry.js';

assert.equal(hasApp('indomark'), true);
assert.equal(hasApp('indoone'), true);
assert.equal(getAppConfig('INDOONE').id, 'indoone');
assert.throws(() => getAppConfig('unknown-app'), /Unknown application/);

const ids = listApps().map(app => app.id).sort();
assert.deepEqual(ids, ['indomark', 'indoone']);

console.log('app-registry checks passed');
