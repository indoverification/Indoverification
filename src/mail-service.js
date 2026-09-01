// Shared Zoho Mail API delivery for every registered application.
// SMTP is intentionally not used here: hosted runtimes can block outbound SMTP,
// while the Zoho Mail REST API provides the single reliable delivery path.
const SENDER_NAME = 'Indoverification';
const SENDER_EMAIL = String(process.env.ZOHO_FROM || 'indogroup@zohomail.in').trim().toLowerCase();

const MAIL_API_TIMEOUT_MS = Math.max(5000, Number(process.env.MAIL_API_TIMEOUT_MS || 15000));
// Indoone/Indoverification currently uses Zoho's India data center.
// Keep the Mail API host fixed so a stale Railway variable cannot route mail
// requests to a generic/wrong Zoho host and produce HTTP 404 responses.
const ZOHO_ACCOUNTS_URL = 'https://accounts.zoho.in';
const ZOHO_MAIL_API_URL = 'https://mail.zoho.in';
const ZOHO_CLIENT_ID = String(process.env.ZOHO_CLIENT_ID || '').trim();
const ZOHO_CLIENT_SECRET = String(process.env.ZOHO_CLIENT_SECRET || '').trim();
const ZOHO_REFRESH_TOKEN = String(process.env.ZOHO_REFRESH_TOKEN || process.env.ZOHO_OAUTH_REFRESH_TOKEN || '').trim();
const ZOHO_ACCOUNT_ID = String(process.env.ZOHO_ACCOUNT_ID || '').trim();

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

function zohoConfigured() {
  return Boolean(ZOHO_CLIENT_ID && ZOHO_CLIENT_SECRET && ZOHO_REFRESH_TOKEN && ZOHO_ACCOUNT_ID);
}

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAIL_API_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    return { response, body };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Zoho Mail API request timed out after ${MAIL_API_TIMEOUT_MS}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshAccessToken() {
  if (!zohoConfigured()) throw new Error('Zoho Mail API is not configured.');
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
      throw new Error(`Zoho OAuth token refresh failed: ${body?.error_description || body?.error || `HTTP ${response.status}`}`);
    }

    const expiresIn = Math.max(60, Number(body?.expires_in || 3600));
    cachedAccessToken = accessToken;
    cachedAccessTokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;
    return cachedAccessToken;
  })().finally(() => { refreshPromise = null; });

  return refreshPromise;
}

async function getAccessToken(forceRefresh = false) {
  if (!forceRefresh && cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt) return cachedAccessToken;
  return refreshAccessToken();
}

async function sendViaZohoApi({ to, subject, html }, forceRefresh = false) {
  const accessToken = await getAccessToken(forceRefresh);
  const url = `${ZOHO_MAIL_API_URL}/api/accounts/${encodeURIComponent(ZOHO_ACCOUNT_ID)}/messages`;
  const payload = {
    fromAddress: SENDER_EMAIL,
    toAddress: to,
    subject: String(subject || '').trim(),
    content: String(html || ''),
    mailFormat: 'html',
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

  const error = new Error(
    `Zoho Mail API delivery failed: ${body?.status?.description || body?.data?.errorMessage || body?.data?.errorCode || body?.message || body?.error || `HTTP ${response.status}`}`
  );
  error.status = response.status;
  throw error;
}

function addVerificationNote(subject, html) {
  const normalizedSubject = String(subject || '').trim().toLowerCase();
  if (!normalizedSubject.includes('verify your email')) return String(html || '');
  const note = '<p style="margin:18px 0 0;text-align:center;color:#111111;font-size:18px;font-weight:800;line-height:1.6">Your email is verified by <strong style="color:#000000;font-weight:900">Indoverification</strong>.</p>';
  const content = String(html || '');
  return /<\/body>\s*<\/html>\s*$/i.test(content)
    ? content.replace(/<\/body>\s*<\/html>\s*$/i, `${note}</body></html>`)
    : `${content}${note}`;
}

export async function sendMail({ to, subject, html }) {
  const recipient = normalizeRecipient(to);
  if (!zohoConfigured()) throw new Error('Zoho Mail API is not configured on the server.');
  const finalHtml = addVerificationNote(subject, html);

  try {
    const result = await sendViaZohoApi({ to: recipient, subject, html: finalHtml });
    console.log(`MAIL SEND ACCEPTED provider=zoho-mail-api sender=${SENDER_NAME} <${SENDER_EMAIL}> recipient=${recipient}`);
    return result;
  } catch (error) {
    if (error?.status === 401) {
      cachedAccessToken = '';
      cachedAccessTokenExpiresAt = 0;
      const result = await sendViaZohoApi({ to: recipient, subject, html: finalHtml }, true);
      console.log(`MAIL SEND ACCEPTED provider=zoho-mail-api sender=${SENDER_NAME} <${SENDER_EMAIL}> recipient=${recipient} retry=token-refresh`);
      return result;
    }
    throw error;
  }
}

export const SHARED_SENDER = Object.freeze({ name: SENDER_NAME, email: SENDER_EMAIL });
