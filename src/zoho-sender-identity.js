import 'dotenv/config';

const ZOHO_ACCOUNTS_URL = String(process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in').replace(/\/$/, '');
const ZOHO_MAIL_API_URL = String(process.env.ZOHO_MAIL_API_URL || 'https://mail.zoho.in').replace(/\/$/, '');
const CLIENT_ID = String(process.env.ZOHO_CLIENT_ID || '').trim();
const CLIENT_SECRET = String(process.env.ZOHO_CLIENT_SECRET || '').trim();
const REFRESH_TOKEN = String(process.env.ZOHO_REFRESH_TOKEN || process.env.ZOHO_OAUTH_REFRESH_TOKEN || '').trim();
const ACCOUNT_ID = String(process.env.ZOHO_ACCOUNT_ID || '').trim();
const DISPLAY_NAME = String(process.env.ZOHO_FROM_DISPLAY_NAME || 'IndoVerification').trim() || 'IndoVerification';

async function getAccessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !ACCOUNT_ID) {
    throw new Error('Zoho sender identity configuration is incomplete.');
  }
  const params = new URLSearchParams({
    refresh_token: REFRESH_TOKEN,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const response = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token?${params.toString()}`, { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(body.error || `Zoho token request failed (${response.status})`);
  }
  return body.access_token;
}

export async function ensureZohoSenderDisplayName() {
  const token = await getAccessToken();
  const response = await fetch(`${ZOHO_MAIL_API_URL}/api/accounts/${encodeURIComponent(ACCOUNT_ID)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ mode: 'updateDisplayName', displayName: DISPLAY_NAME }),
  });
  const body = await response.json().catch(() => ({}));
  const apiCode = body?.status?.code;
  if (!response.ok || (apiCode !== undefined && Number(apiCode) !== 200)) {
    throw new Error(body?.status?.description || body?.message || `Zoho display-name update failed (${response.status})`);
  }
  console.log(`Zoho sender display name enforced: ${DISPLAY_NAME}`);
}
