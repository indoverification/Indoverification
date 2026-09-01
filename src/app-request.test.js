import assert from 'node:assert/strict';
import { resolveAppContext, resolveAppId } from './app-request.js';

assert.equal(resolveAppId({ body: { appId: 'indoone' } }), 'indoone');
assert.equal(resolveAppId({ headers: { 'x-indo-app-id': 'indoone' } }), 'indoone');
assert.equal(resolveAppId({ headers: { 'x-indo-app-name': 'indomark' } }), 'indomark');
assert.equal(resolveAppId({}), 'indomark');
assert.throws(() => resolveAppId({ body: { appId: 'not-registered' } }), /Unknown application/);

assert.equal(
  resolveAppContext({ body: { appId: 'indoone' }, origin: 'https://indooneteam.github.io' }).appId,
  'indoone',
);
assert.throws(
  () => resolveAppContext({ body: { appId: 'indoone' }, origin: 'https://indomark.github.io' }),
  /origin is not allowed/i,
);

console.log('app-request isolation checks passed');
