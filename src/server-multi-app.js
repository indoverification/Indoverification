import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import 'dotenv/config';
import { getAppConfig, listApps, DEFAULT_APP_ID, appRoot } from './app-registry.js';
import { resolveAppContext, appIdForOrigin, APP_ID_HEADER, LEGACY_APP_HEADER } from './app-request.js';
import { sendMail } from './mail-service.js';

const { Pool } = pg;
const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const OTP_TTL_MS = Math.max(60, Number(process.env.OTP_TTL_SECONDS || 600)) * 1000;
const OTP_RESEND_MS = Math.max(15, Number(process.env.OTP_RESEND_SECONDS || 60)) * 1000;
const OTP_MAX_ATTEMPTS = Math.max(1, Number(process.env.OTP_MAX_ATTEMPTS || 5));
const WELCOME_TOKEN_TTL_MS = 15 * 60 * 1000;

if (!DATABASE_URL) throw new Error('DATABASE_URL is required.');
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: String(process.env.PGSSL || 'false') === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function appFromRequest(req, body = {}) {
  return resolveAppContext({ body, headers: req.headers, origin: req.headers.origin });
}

function setCors(res, req) {
  const origin = String(req.headers.origin || '').trim();
  let appId = String(req.headers[APP_ID_HEADER] || req.headers[LEGACY_APP_HEADER] || '').trim().toLowerCase();
  if (!appId && origin) appId = appIdForOrigin(origin);

  let allowOrigin = '';
  if (appId) {
    try { allowOrigin = new URL(getAppConfig(appId).url).origin; } catch {}
  }
  if (origin && allowOrigin && origin === allowOrigin) res.setHeader('Access-Control-Allow-Origin', origin);
  else if (!origin && allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Indo-App-Id, X-Indo-App-Name');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Request too large');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('Invalid JSON'); }
}

function email(value) {
  return String(value || '').normalize('NFKC').replace(/[\u0000-\u001F\u007F\u00A0\u200B-\u200D\u2060\uFEFF]/g, '').trim().toLowerCase();
}
function validEmail(value) { return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(email(value)); }
function normalizeOtp(value) { return String(value || '').normalize('NFKC').replace(/[^0-9]/g, '').slice(0, 6); }
function generateOtp() { return String(crypto.randomInt(100000, 1000000)); }
function generateToken(bytes = 24) { return crypto.randomBytes(bytes).toString('hex'); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function sameHash(a, b) {
  const left = Buffer.from(String(a), 'hex');
  const right = Buffer.from(String(b), 'hex');
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}
function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function loadBrand(appId) {
  const root = appRoot(appId);
  const manifestPath = `${root}/email-templates.json`;
  const fallback = { appId, templates: { signupOtp: 'signup-otp', loginOtp: 'login-otp', welcome: 'welcome' }, branding: { name: getAppConfig(appId).name, logoAsset: '', primaryColor: '#2563EB' } };
  try {
    const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return { ...fallback, ...value, branding: { ...fallback.branding, ...(value.branding || {}) } };
  } catch {
    return fallback;
  }
}

function logoHtml(brand) {
  const name = escapeHtml(brand.branding.name);
  const color = escapeHtml(brand.branding.primaryColor || '#2563EB');
  return `<div style="font-size:28px;line-height:1;font-weight:900;color:${color}">${name}</div>`;
}

function emailShell(appId, { eyebrow, body, welcome = false }) {
  const brand = loadBrand(appId);
  const name = escapeHtml(brand.branding.name);
  const color = escapeHtml(brand.branding.primaryColor || '#2563EB');
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f5f8fc;color:#152033;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#fff;border:1px solid #dce5f0;border-radius:16px;overflow:hidden"><tr><td align="center" style="padding:28px 20px 22px;border-bottom:1px solid #e7edf5">${logoHtml(brand)}<div style="margin-top:8px;color:#6b778c;font-size:12px">${escapeHtml(eyebrow)}</div></td></tr><tr><td style="padding:30px 26px">${body}</td></tr><tr><td align="center" style="padding:18px 20px;background:#f8fafc;border-top:1px solid #e7edf5;color:#7b8799;font-size:12px;line-height:1.7">Automated email from <strong style="color:${color}">${name}</strong>${welcome ? '' : '. Please do not share your OTP.'}</td></tr></table></td></tr></table></body></html>`;
}

function otpBox(code, color) {
  return `<div style="margin:22px 0;padding:20px;background:#f7f9fc;border:1px solid #dce5f0;border-radius:13px;text-align:center"><div style="font-size:11px;color:#7b8799;letter-spacing:1.5px;text-transform:uppercase;font-weight:800">Your OTP code</div><div style="margin-top:10px;font-size:34px;letter-spacing:9px;font-weight:900;color:${escapeHtml(color)}">${escapeHtml(code)}</div></div>`;
}

async function mailOtp(appId, to, code, kind) {
  const brand = loadBrand(appId);
  const name = brand.branding.name || getAppConfig(appId).name;
  const color = brand.branding.primaryColor || '#2563EB';
  const isSignup = kind === 'signup';
  const body = `<h1 style="margin:0 0 10px;font-size:26px">${isSignup ? 'Verify your email' : 'Login verification'}</h1><p style="margin:0;color:#526177;font-size:15px;line-height:1.7">${isSignup ? `Use this code to verify your email and create your ${escapeHtml(name)} account.` : `Use this code to securely complete your ${escapeHtml(name)} login.`}</p>${otpBox(code, color)}<p style="margin:0;text-align:center;color:#7b8799;font-size:13px;line-height:1.7">This OTP is valid for <strong style="color:${escapeHtml(color)}">${Math.round(OTP_TTL_MS / 60000)} minutes</strong>.</p>`;
  const content = emailShell(appId, { eyebrow: isSignup ? 'Secure account registration' : 'Secure login verification', body });
  await sendMail({ to, subject: `${name} • ${isSignup ? 'Verify your email' : 'Login verification code'}`, html: content });
}

async function mailNewAccountWelcome(appId, to, nameValue) {
  const brand = loadBrand(appId);
  const name = brand.branding.name || getAppConfig(appId).name;
  const color = brand.branding.primaryColor || '#2563EB';
  const safeName = escapeHtml(nameValue || 'there');
  const body = `<h1 style="margin:0 0 10px;font-size:27px">Welcome to <span style="color:${escapeHtml(color)}">${escapeHtml(name)}</span>!</h1><p style="margin:0;color:#526177;font-size:16px;line-height:1.7">Hi ${safeName},</p><p style="margin:8px 0 20px;color:#65738a;font-size:15px;line-height:1.7">Your account has been created successfully.</p>`;
  const content = emailShell(appId, { eyebrow: 'Account created successfully', body, welcome: true });
  await sendMail({ to, subject: `${name} • Welcome — your account is ready`, html: content });
}

async function mailWelcomeBack(appId, to, nameValue) {
  const brand = loadBrand(appId);
  const name = brand.branding.name || getAppConfig(appId).name;
  const color = brand.branding.primaryColor || '#2563EB';
  const safeName = escapeHtml(nameValue || 'there');
  const body = `<h1 style="margin:0 0 10px;font-size:27px">Welcome <span style="color:${escapeHtml(color)}">back</span>!</h1><p style="margin:0;color:#526177;font-size:16px;line-height:1.7">Hi ${safeName}, you have successfully logged in to your ${escapeHtml(name)} account.</p>`;
  const content = emailShell(appId, { eyebrow: 'Login successful', body, welcome: true });
  await sendMail({ to, subject: `${name} • Welcome back — login successful`, html: content });
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      otp_key TEXT PRIMARY KEY,
      app_id TEXT NOT NULL DEFAULT 'indomark',
      email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      challenge_id TEXT
    );
    ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS app_id TEXT;
    UPDATE otp_codes SET app_id='indomark' WHERE app_id IS NULL;
    ALTER TABLE otp_codes ALTER COLUMN app_id SET DEFAULT 'indomark';
    ALTER TABLE otp_codes ALTER COLUMN app_id SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS otp_codes_challenge_id_uq ON otp_codes(challenge_id) WHERE challenge_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS otp_codes_app_email_purpose_sent_idx ON otp_codes(app_id,email,purpose,sent_at DESC);

    CREATE TABLE IF NOT EXISTS signup_welcome_tokens (
      token_hash TEXT PRIMARY KEY,
      app_id TEXT NOT NULL DEFAULT 'indomark',
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );
    ALTER TABLE signup_welcome_tokens ADD COLUMN IF NOT EXISTS app_id TEXT;
    UPDATE signup_welcome_tokens SET app_id='indomark' WHERE app_id IS NULL;
    ALTER TABLE signup_welcome_tokens ALTER COLUMN app_id SET DEFAULT 'indomark';
    ALTER TABLE signup_welcome_tokens ALTER COLUMN app_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS signup_welcome_tokens_app_email_idx ON signup_welcome_tokens(app_id,email,created_at DESC);
    DELETE FROM otp_codes WHERE expires_at < NOW();
    DELETE FROM signup_welcome_tokens WHERE expires_at < NOW();
  `);
}

async function issueOtp(appId, emailAddress, purpose) {
  const recipient = email(emailAddress);
  const latest = await pool.query('SELECT sent_at FROM otp_codes WHERE app_id=$1 AND email=$2 AND purpose=$3 ORDER BY sent_at DESC LIMIT 1', [appId, recipient, purpose]);
  const now = new Date();
  if (latest.rows[0] && now.getTime() - new Date(latest.rows[0].sent_at).getTime() < OTP_RESEND_MS) throw new Error('Please wait before requesting another OTP.');
  await pool.query('DELETE FROM otp_codes WHERE app_id=$1 AND email=$2 AND purpose=$3', [appId, recipient, purpose]);
  const code = generateOtp();
  const challenge = generateToken();
  await pool.query('INSERT INTO otp_codes (otp_key,app_id,email,purpose,code_hash,sent_at,expires_at,attempts,challenge_id) VALUES ($1,$2,$3,$4,$5,$6,$7,0,$1)', [challenge, appId, recipient, purpose, hash(code), now, new Date(now.getTime() + OTP_TTL_MS)]);
  try { await mailOtp(appId, recipient, code, purpose); }
  catch (error) { await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [challenge]).catch(() => {}); throw error; }
  return challenge;
}

async function verifyOtp(appId, challengeId, emailAddress, submittedOtp) {
  const key = String(challengeId || '').trim();
  const recipient = email(emailAddress);
  const result = await pool.query('SELECT * FROM otp_codes WHERE challenge_id=$1 AND app_id=$2 AND email=$3 LIMIT 1', [key, appId, recipient]);
  const item = result.rows[0];
  if (!item) throw new Error('OTP not found or expired.');
  if (Date.now() > new Date(item.expires_at).getTime()) { await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [item.otp_key]); throw new Error('OTP expired.'); }
  if (item.attempts >= OTP_MAX_ATTEMPTS) { await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [item.otp_key]); throw new Error('Too many incorrect attempts.'); }
  const submitted = normalizeOtp(submittedOtp);
  if (!/^\d{6}$/.test(submitted) || !sameHash(hash(submitted), item.code_hash)) {
    await pool.query('UPDATE otp_codes SET attempts=attempts+1 WHERE otp_key=$1', [item.otp_key]);
    throw new Error('Invalid OTP.');
  }
  await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [item.otp_key]);
  return item;
}

async function createSignupWelcomeToken(appId, emailAddress, name) {
  const recipient = email(emailAddress);
  const token = generateToken();
  await pool.query('DELETE FROM signup_welcome_tokens WHERE app_id=$1 AND email=$2 AND used_at IS NULL', [appId, recipient]);
  await pool.query('INSERT INTO signup_welcome_tokens (token_hash,app_id,email,name,created_at,expires_at) VALUES ($1,$2,$3,$4,NOW(),$5)', [hash(token), appId, recipient, String(name || '').trim(), new Date(Date.now() + WELCOME_TOKEN_TTL_MS)]);
  return token;
}

async function consumeSignupWelcomeToken(appId, token, emailAddress, name) {
  const recipient = email(emailAddress);
  const tokenHash = hash(token);
  const result = await pool.query('SELECT * FROM signup_welcome_tokens WHERE token_hash=$1 AND app_id=$2 AND email=$3 LIMIT 1', [tokenHash, appId, recipient]);
  const item = result.rows[0];
  if (!item || item.used_at) throw new Error('Welcome email authorization expired.');
  if (Date.now() > new Date(item.expires_at).getTime()) { await pool.query('DELETE FROM signup_welcome_tokens WHERE token_hash=$1', [tokenHash]); throw new Error('Welcome email authorization expired.'); }
  await mailNewAccountWelcome(appId, recipient, String(name || item.name || 'there').trim());
  await pool.query('UPDATE signup_welcome_tokens SET used_at=NOW() WHERE token_hash=$1 AND used_at IS NULL', [tokenHash]);
}

async function main(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, service: 'IndoVerification', role: 'multi-app OTP service', apps: listApps().map(({ id, name }) => ({ id, name })), emailConfigured: Boolean(process.env.SMTP_USER && (process.env.SMTP_PASS || process.env.SMTP_PASSWORD) && process.env.SMTP_HOST && process.env.SMTP_PORT), time: new Date().toISOString() });

    const body = await readBody(req);
    const context = appFromRequest(req, body);
    const appId = context.appId;

    if (url.pathname === '/api/auth/signup/request-otp' && req.method === 'POST') {
      const e = email(body.email); const name = String(body.name || '').trim();
      if (!name || !validEmail(e)) return sendJson(res, 400, { ok: false, error: 'Name and a valid email are required.' });
      const challengeId = await issueOtp(appId, e, 'signup');
      return sendJson(res, 200, { ok: true, message: 'OTP sent to your email.', challengeId, appId });
    }

    if (url.pathname === '/api/auth/signup/verify-otp' && req.method === 'POST') {
      const e = email(body.email); if (!validEmail(e)) return sendJson(res, 400, { ok: false, error: 'Enter a valid email.' });
      const verification = await verifyOtp(appId, body.challengeId, e, body.otp);
      if (verification.purpose !== 'signup') return sendJson(res, 400, { ok: false, error: 'OTP request mismatch.' });
      const name = String(body.name || '').trim(); const welcomeToken = await createSignupWelcomeToken(appId, e, name);
      return sendJson(res, 200, { ok: true, verified: true, email: e, name, welcomeToken, appId });
    }

    if (url.pathname === '/api/auth/signup/welcome' && req.method === 'POST') {
      const e = email(body.email); if (!validEmail(e)) return sendJson(res, 400, { ok: false, error: 'Enter a valid email.' });
      await consumeSignupWelcomeToken(appId, body.welcomeToken, e, String(body.name || '').trim());
      return sendJson(res, 200, { ok: true, welcomeSent: true, appId });
    }

    if (url.pathname === '/api/auth/login/request-otp' && req.method === 'POST') {
      const e = email(body.email); if (!validEmail(e)) return sendJson(res, 400, { ok: false, error: 'Enter a valid email.' });
      const challengeId = await issueOtp(appId, e, 'login');
      return sendJson(res, 200, { ok: true, message: 'OTP sent to your email.', challengeId, appId });
    }

    if (url.pathname === '/api/auth/login/verify-otp' && req.method === 'POST') {
      const e = email(body.email); if (!validEmail(e)) return sendJson(res, 400, { ok: false, error: 'Enter a valid email.' });
      const verification = await verifyOtp(appId, body.challengeId, e, body.otp);
      if (verification.purpose !== 'login') return sendJson(res, 400, { ok: false, error: 'OTP request mismatch.' });
      let welcomeSent = true;
      try { await mailWelcomeBack(appId, e, String(body.name || '').trim()); } catch (error) { welcomeSent = false; console.error('Welcome-back email failed:', error instanceof Error ? error.message : error); }
      return sendJson(res, 200, { ok: true, verified: true, email: e, welcomeSent, appId });
    }

    if (url.pathname === '/api/auth/resend-otp' && req.method === 'POST') {
      const e = email(body.email); const purpose = String(body.purpose || 'signup');
      if (!validEmail(e)) return sendJson(res, 400, { ok: false, error: 'Enter a valid email.' });
      if (!['signup', 'login'].includes(purpose)) return sendJson(res, 400, { ok: false, error: 'Invalid OTP purpose.' });
      const challengeId = await issueOtp(appId, e, purpose);
      return sendJson(res, 200, { ok: true, message: 'OTP resent.', challengeId, appId });
    }

    return sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    console.error('REQUEST ERROR:', error);
    const message = error instanceof Error ? error.message : 'Server error';
    const status = /Zoho Mail API|Zoho token|Zoho Mail send|configured Zoho sender|recipient email address|SMTP/i.test(message) ? 503 : 400;
    return sendJson(res, status, { ok: false, error: message });
  }
}

initDb().then(() => http.createServer(main).listen(PORT, HOST, () => console.log(`IndoVerification multi-app service listening on ${HOST}:${PORT}`))).catch((error) => { console.error('Startup failed:', error); process.exit(1); });
