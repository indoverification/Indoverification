// One shared Zoho Mail API transport for every application.
// App-specific branding/templates are supplied by the caller; this service owns
// only the global sender identity and Zoho authentication/delivery.

const SENDER_NAME = 'Indoverification';
const SENDER_EMAIL = 'indogroup@zohomail.in';
const ZOHO_ACCOUNTS_URL = String(process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in').trim().replace(/\/$/, '');
const ZOHO_MAIL_API_URL = String(process.env.ZOHO_MAIL_API_URL || 'https://mail.zoho.in').trim().replace(/\/$/, '');
const ZOHO_CLIENT_ID = String(process.env.ZOHO_CLIENT_ID || '').trim();
const ZOHO_CLIENT_SECRET = String(process.env.ZOHO_CLIENT_SECRET || '').trim();
const ZOHO_REFRESH_TOKEN = String(process.env.ZOHO_REFRESH_TOKEN || '').trim();
const ZOHO_ACCOUNT_ID = String(process.env.ZOHO_ACCOUNT_ID || '').trim();
const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.MAIL_API_TIMEOUT_MS || 15000));

let cachedAccessToken = '';
let cachedAccessTokenExpiresAt = 0;
let refreshPromise = null;

function normalizeRecipient(value) {
  const recipient = String(value || '').normalize('NFKC').trim().toLowerCase();
  if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(recipient)) {
    throw new Error('The recipient email address is invalid.');
  }
  return recipient;
}

function assertConfigured() {
  const missing = [];
  if (!ZOHO_CLIENT_ID) missing.push('ZOHO_CLIENT_ID');
  if (!ZOHO_CLIENT_SECRET) missing.push('ZOHO_CLIENT_SECRET');
  if (!ZOHO_REFRESH_TOKEN) missing.push('ZOHO_REFRESH_TOKEN');
  if (!ZOHO_ACCOUNT_ID) missing.push('ZOHO_ACCOUNT_ID');
  if (missing.length) throw new Error(`Zoho Mail API is not configured. Missing: ${missing.join(', ')}.`);
}

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    return { response, body };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Zoho Mail API request timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshAccessToken() {
  assertConfigured();
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const params = new URLSearchParams({
      refresh_token: ZOHO_REFRESH_TOKEN,
      client_id: ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });

    const { response, body } = await fetchJson(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const accessToken = String(body?.access_token || '').trim();
    if (!response.ok || !accessToken) {
      const description = body?.error || body?.error_description || body?.message || `HTTP ${response.status}`;
      throw new Error(`Zoho OAuth token refresh failed: ${description}`);
    }

    const expiresIn = Math.max(60, Number(body?.expires_in || 3600));
    cachedAccessToken = accessToken;
    cachedAccessTokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;
    return cachedAccessToken;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function getAccessToken(forceRefresh = false) {
  if (!forceRefresh && cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt) return cachedAccessToken;
  return refreshAccessToken();
}

function extractZohoError(body, status) {
  return body?.status?.description || body?.data?.errorMessage || body?.data?.errorCode || body?.message || body?.error || body?.error_description || `HTTP ${status}`;
}

async function sendViaZohoApi({ to, subject, html }, forceRefresh = false) {
  const accessToken = await getAccessToken(forceRefresh);
  const url = `${ZOHO_MAIL_API_URL}/api/accounts/${encodeURIComponent(ZOHO_ACCOUNT_ID)}/messages`;
  const payload = {
    fromAddress: SENDER_EMAIL,
    toAddress: to,
    subject: String(subject || '').trim(),
    content: String(html || ''),
  };

  const { response, body } = await fetchJson(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Zoho-oauthtoken ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const apiCode = Number(body?.status?.code || 0);
  if (response.ok && (apiCode === 0 || apiCode === 200 || body?.status?.description === 'success')) return body;

  const message = extractZohoError(body, response.status);
  const error = new Error(`Zoho Mail API delivery failed: ${message}`);
  error.status = response.status;
  error.zohoBody = body;
  throw error;
}

export async function sendMail({ to, subject, html }) {
  const recipient = normalizeRecipient(to);
  assertConfigured();

  try {
    const result = await sendViaZohoApi({ to: recipient, subject, html });
    console.log(`MAIL SEND ACCEPTED provider=zoho-mail-api sender=${SENDER_NAME} <${SENDER_EMAIL}> recipient=${recipient}`);
    return result;
  } catch (error) {
    // A rejected/expired access token should trigger one fresh token and one
    // retry. Do not retry delivery failures more than once and do not fall
    // back to SMTP or another provider.
    if (error?.status === 401 || /INVALID_TICKET|invalid.*token|token.*expired/i.test(String(error?.message || ''))) {
      cachedAccessToken = '';
      cachedAccessTokenExpiresAt = 0;
      const result = await sendViaZohoApi({ to: recipient, subject, html }, true);
      console.log(`MAIL SEND ACCEPTED provider=zoho-mail-api sender=${SENDER_NAME} <${SENDER_EMAIL}> recipient=${recipient} retry=token-refresh`);
      return result;
    }
    throw error;
  }
}

export const SHARED_SENDER = Object.freeze({ name: SENDER_NAME, email: SENDER_EMAIL });
