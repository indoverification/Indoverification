import 'dotenv/config';

const ZOHO_ACCOUNTS_URL = String(process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in').replace(/\/$/, '');
const ZOHO_MAIL_API_URL = String(process.env.ZOHO_MAIL_API_URL || 'https://mail.zoho.in').replace(/\/$/, '');
const CLIENT_ID = String(process.env.ZOHO_CLIENT_ID || '').trim();
const CLIENT_SECRET = String(process.env.ZOHO_CLIENT_SECRET || '').trim();
const REFRESH_TOKEN = String(process.env.ZOHO_REFRESH_TOKEN || process.env.ZOHO_OAUTH_REFRESH_TOKEN || '').trim();
const ACCOUNT_ID = String(process.env.ZOHO_ACCOUNT_ID || '').trim();
const DISPLAY_NAME = String(process.env.ZOHO_FROM_DISPLAY_NAME || 'IndoVerification').trim() || 'IndoVerification';
const RAW_FROM = String(process.env.ZOHO_FROM || '').trim();

function emailAddress(value) {
  const match = String(value || '').match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/i);
  if (match?.[1]) return match[1].trim().toLowerCase();
  return String(value || '').trim().toLowerCase();
}

async function getAccessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !ACCOUNT_ID || !RAW_FROM) {
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
  const senderAddress = emailAddress(RAW_FROM);
  if (!senderAddress.includes('@')) throw new Error('ZOHO_FROM must contain a valid sender email address.');

  // Documented Zoho Mail API contract for updating Send Mail As display name.
  // Requires ZohoMail.accounts.UPDATE (or ZohoMail.accounts.ALL) on the OAuth token.
  const response = await fetch(`${ZOHO_MAIL_API_URL}/api/accounts/${encodeURIComponent(ACCOUNT_ID)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      mode: 'addsendmaildetails',
      sendMailDetails: [{
        fromAddress: senderAddress,
        displayName: DISPLAY_NAME,
        mode: 'extmailbox',
      }],
    }),
  });
  const body = await response.json().catch(() => ({}));
  const apiCode = body?.status?.code;
  if (!response.ok || (apiCode !== undefined && Number(apiCode) !== 200)) {
    const description = body?.status?.description || body?.message || `Zoho display-name update failed (${response.status})`;
    if (response.status === 401) {
      throw new Error(`${description}. Zoho OAuth token requires ZohoMail.accounts.UPDATE (or ZohoMail.accounts.ALL).`);
    }
    throw new Error(description);
  }
  console.log(`Zoho sender display name configured globally: ${DISPLAY_NAME}`);
}
