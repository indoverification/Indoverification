import 'dotenv/config';

const required = [
  'JWT_SECRET',
  'DATABASE_URL',
  'ZOHO_CLIENT_ID',
  'ZOHO_CLIENT_SECRET',
  'ZOHO_REFRESH_TOKEN',
  'ZOHO_ACCOUNT_ID',
  'ZOHO_FROM',
];

const missing = required.filter((key) => !String(process.env[key] || '').trim());

if (missing.length) {
  console.error(`IndoVerification runtime configuration missing: ${missing.join(', ')}`);
  console.error('Check the active Railway environment/service variables. Secret values are intentionally not printed.');
  process.exit(1);
}

console.log('IndoVerification runtime configuration: all required variables are present.');
await import('./server.js');
