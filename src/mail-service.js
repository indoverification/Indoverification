// One shared mail transport for every application.
// App-specific branding/templates are supplied by the caller; this service owns
// only the global sender identity and delivery transport.

import nodemailer from 'nodemailer';

const SENDER_NAME = 'Indoverification';
const SENDER_EMAIL = 'indogroup@zohomail.in';
const SMTP_HOST = String(process.env.SMTP_HOST || 'smtp.zoho.com').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = String(process.env.SMTP_USER || SENDER_EMAIL).trim();
const SMTP_PASS = String(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '').trim();
const SMTP_FROM = String(process.env.SMTP_FROM || SENDER_EMAIL).trim();
const SMTP_SECURE = String(process.env.SMTP_SECURE || (SMTP_PORT === 465 ? 'true' : 'false')).toLowerCase() === 'true';
const SMTP_TIMEOUT_MS = Math.max(5000, Number(process.env.SMTP_TIMEOUT_MS || process.env.MAIL_API_TIMEOUT_MS || 15000));
const MAIL_PROVIDER = String(process.env.MAIL_PROVIDER || 'auto').trim().toLowerCase();

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

function smtpConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function zohoApiConfigured() {
  return Boolean(ZOHO_CLIENT_ID && ZOHO_CLIENT_SECRET && ZOHO_REFRESH_TOKEN && ZOHO_ACCOUNT_ID);
}

function getTransporter() {
  if (!smtpConfigured()) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });

  return transporter;
}

async function sendViaSmtp({ to, subject, html }) {
  const client = getTransporter();
  if (!client) throw new Error('Zoho SMTP is not configured.');

  return client.sendMail({
    from: {
      name: SENDER_NAME,
      address: SMTP_FROM,
    },
    to,
    subject: String(subject || '').trim(),
    html: String(html || ''),
  });
}

function assertZohoApiConfigured() {
  const missing = [];
  if (!ZOHO_CLIENT_ID) missing.push('ZOHO_CLIENT_ID');
  if (!ZOHO_CLIENT_SECRET) missing.push('ZOHO_CLIENT_SECRET');
  if (!ZOHO_REFRESH_TOKEN) missing.push('ZOHO_REFRESH_TOKEN');
  if (!ZOHO_ACCOUNT_ID) missing.push('ZOHO_ACCOUNT_ID');
  if (missing.length) throw new Error(`Zoho Mail API is not configured. Missing: ${missing.join(', ')}.`);
}

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SMTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    return { response, body };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Zoho Mail API request timed out after ${SMTP_TIMEOUT_MS}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshAccessToken() {
  assertZohoApiConfigured();
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

async function sendByConfiguredTransport(mail) {
  if (MAIL_PROVIDER === 'smtp') return sendViaSmtp(mail);
  if (MAIL_PROVIDER === 'zoho-api') return sendViaZohoApi(mail);

  if (smtpConfigured()) {
    try {
      return await sendViaSmtp(mail);
    } catch (smtpError) {
      console.warn(`MAIL SMTP FAILED fallback=zoho-mail-api reason=${smtpError?.message || smtpError}`);
      if (!zohoApiConfigured()) throw smtpError;
    }
  }

  return sendViaZohoApi(mail);
}

export async function sendMail({ to, subject, html }) {
  const recipient = normalizeRecipient(to);
  const mail = { to: recipient, subject, html };

  try {
    const result = await sendByConfiguredTransport(mail);
    const provider = MAIL_PROVIDER === 'zoho-api' || (!smtpConfigured() && MAIL_PROVIDER !== 'smtp') ? 'zoho-mail-api' : 'nodemailer-smtp';
    console.log(`MAIL SEND ACCEPTED provider=${provider} sender=${SENDER_NAME} <${SENDER_EMAIL}> recipient=${recipient}`);
    return result;
  } catch (error) {
    if (MAIL_PROVIDER !== 'smtp' && zohoApiConfigured() && (error?.status === 401 || /INVALID_TICKET|invalid.*token|token.*expired/i.test(String(error?.message || '')))) {
      cachedAccessToken = '';
      cachedAccessTokenExpiresAt = 0;
      const result = await sendViaZohoApi(mail, true);
      console.log(`MAIL SEND ACCEPTED provider=zoho-mail-api sender=${SENDER_NAME} <${SENDER_EMAIL}> recipient=${recipient} retry=token-refresh`);
      return result;
    }
    throw error;
  }
}

export const SHARED_SENDER = Object.freeze({ name: SENDER_NAME, email: SENDER_EMAIL });
