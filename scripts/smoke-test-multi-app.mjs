import process from 'node:process';

const base = (process.env.INDOVERIFICATION_BASE_URL || '').replace(/\/$/, '');
if (!base) {
  console.error('INDOVERIFICATION_BASE_URL is required.');
  process.exit(1);
}

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  return { response, body };
}

const health = await request('/health');
if (!health.response.ok || health.body?.ok !== true) {
  throw new Error(`Health check failed: HTTP ${health.response.status}`);
}

const results = health.body.apps || [];
const ids = new Set(results.map((app) => app.id));
for (const expected of ['indomark', 'indoone']) {
  if (!ids.has(expected)) throw new Error(`Expected registered app missing: ${expected}`);
}

const blocked = await request('/api/auth/login/request-otp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': 'https://indomark.github.io',
  },
  body: JSON.stringify({
    appId: 'indoone',
    email: 'smoke-test@example.invalid',
  }),
});

if (blocked.response.status !== 400 && blocked.response.status !== 503) {
  throw new Error(`Unexpected runtime response for isolated app smoke test: HTTP ${blocked.response.status}`);
}

console.log(`Smoke checks passed for ${base}`);
