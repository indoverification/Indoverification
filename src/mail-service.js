import nodemailer from 'nodemailer';

// ONE shared mail transport for every application.
// App-specific branding/templates are supplied by the caller; this service owns
// only the global sender identity and delivery transport.
const SENDER_NAME = 'Indoverification';
const SENDER_EMAIL = 'indogroup@zohomail.in';

const SMTP_HOST = String(process.env.SMTP_HOST || 'smtp.zoho.com').trim();
const SMTP_PORT = Math.max(1, Number(process.env.SMTP_PORT || 465));
const SMTP_USER = String(process.env.SMTP_USER || SENDER_EMAIL).trim();
const SMTP_PASSWORD = String(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '').trim();
const SMTP_FROM = String(process.env.SMTP_FROM || SENDER_EMAIL).trim();
// Railway/hosted runtimes can block or delay outbound SMTP. Keep this leg short
// so the shared Zoho API fallback can take over without making the app appear stuck.
const SMTP_TIMEOUT_MS = Math.max(5000, Number(process.env.SMTP_TIMEOUT_MS || 7000));
const MAIL_API_TIMEOUT_MS = Math.max(5000, Number(process.env.MAIL_API_TIMEOUT_MS || 15000));

const ZOHO_ACCOUNTS_URL = String(process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in').trim().replace(/\/$/, '');
const ZOHO_MAIL_API_URL = String(process.env.ZOHO_MAIL_API_URL || 'https://mail.zoho.in').trim().replace(/\/$/, '');
const ZOHO_CLIENT_ID = String(process.env.ZOHO_CLIENT_ID || '').trim();
const ZOHO_CLIENT_SECRET = String(process.env.ZOHO_CLIENT_SECRET || '').trim();
const ZOHO_REFRESH_TOKEN = String(process.env.ZOHO_REFRESH_TOKEN || process.env.ZOHO_OAUTH_REFRESH_TOKEN || '').trim();
const ZOHO_ACCOUNT_ID = String(process.env.ZOHO_ACCOUNT_ID || '').trim();

let transporter = null;
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

function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_PASSWORD) throw new Error('SMTP_PASS (or SMTP_PASSWORD) is not configured.');
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
  return transporter;
}

async function sendViaSmtp({ to, subject, html }) {
  return getTransporter().sendMail({
    from: { name: SENDER_NAME, address: SMTP_FROM },
    to,
    subject: String(subject || '').trim(),
    html: String(html || ''),
  });
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
  if (!zohoConfigured()) throw new Error('Zoho Mail API fallback is not configured.');
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
    if (!response.ok || !accessToken) throw new Error(`Zoho OAuth token refresh failed: ${body?.error_description || body?.error || `HTTP ${response.status}`}`);
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
    fromAddress: SMTP_FROM,
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
  const error = new Error(`Zoho Mail API delivery failed: ${body?.status?.description || body?.data?.errorMessage || body?.data?.errorCode || body?.message || body?.error || `HTTP ${response.status}`}`);
  error.status = response.status;
  throw error;
}

export async function sendMail({ to, subject, html }) {
  const recipient = normalizeRecipient(to);
  try {
    const result = await sendViaSmtp({ to: recipient, subject, html });
    console.log(`MAIL SEND ACCEPTED provider=nodemailer-smtp sender=${SENDER_NAME} <${SENDER_EMAIL}> recipient=${recipient}`);
    return result;
  } catch (smtpError) {
    console.warn('SMTP delivery failed; using Zoho Mail API fallback:', smtpError instanceof Error ? smtpError.message : smtpError);
    if (!zohoConfigured()) throw smtpError;
    try {
      const result = await sendViaZohoApi({ to: recipient, subject, html });
      console.log(`MAIL SEND ACCEPTED provider=zoho-mail-api-fallback sender=${SENDER_NAME} <${SENDER_EMAIL}> recipient=${recipient}`);
      return result;
    } catch (error) {
      if (error?.status === 401) {
        cachedAccessToken = '';
        cachedAccessTokenExpiresAt = 0;
        const result = await sendViaZohoApi({ to: recipient, subject, html }, true);
        console.log(`MAIL SEND ACCEPTED provider=zoho-mail-api-fallback sender=${SENDER_NAME} <${SENDER_EMAIL}> recipient=${recipient} retry=token-refresh`);
        return result;
      }
      throw error;
    }
  }
}

export const SHARED_SENDER = Object.freeze({ name: SENDER_NAME, email: SENDER_EMAIL });
