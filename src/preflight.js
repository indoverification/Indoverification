import 'dotenv/config';

// Railway workaround: use a uniquely named service variable for the Zoho
// refresh token and map it into the variable name expected by server.js.
if (!String(process.env.ZOHO_REFRESH_TOKEN || '').trim() && String(process.env.ZOHO_OAUTH_REFRESH_TOKEN || '').trim()) {
  process.env.ZOHO_REFRESH_TOKEN = String(process.env.ZOHO_OAUTH_REFRESH_TOKEN).trim();
}

// Only infrastructure-critical variables must exist for the API process to boot.
const required = ['JWT_SECRET', 'DATABASE_URL'];
const missing = required.filter((key) => !String(process.env[key] || '').trim());

if (missing.length) {
  console.error(`IndoVerification runtime configuration missing: ${missing.join(', ')}`);
  console.error('Check the active Railway environment/service variables.');
  process.exit(1);
}

const optionalZoho = [
  'ZOHO_CLIENT_ID',
  'ZOHO_CLIENT_SECRET',
  'ZOHO_REFRESH_TOKEN',
  'ZOHO_ACCOUNT_ID',
  'ZOHO_FROM',
];
const missingZoho = optionalZoho.filter((key) => !String(process.env[key] || '').trim());

if (missingZoho.length) {
  console.warn(`IndoVerification Zoho email configuration incomplete: ${missingZoho.join(', ')}. API will start; email operations will return a configuration error.`);
} else {
  console.log('IndoVerification Zoho email configuration: all required variables are present.');
}

await import('./server.js');
