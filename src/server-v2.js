import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const APP_NAME = 'Indomark';
const APP_TAGLINE = 'Learn. Analyse. Practice. Trade.';
const APP_URL = 'https://indomark.github.io/Indomark/';
const OTP_TTL_MS = Math.max(60, Number(process.env.OTP_TTL_SECONDS || 600)) * 1000;
const OTP_RESEND_MS = Math.max(15, Number(process.env.OTP_RESEND_SECONDS || 60)) * 1000;
const OTP_MAX_ATTEMPTS = Math.max(1, Number(process.env.OTP_MAX_ATTEMPTS || 5));
const WELCOME_TOKEN_TTL_MS = 15 * 60 * 1000;

const ZOHO_ACCOUNTS_URL = String(process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in').replace(/\/$/, '');
const ZOHO_MAIL_API_URL = String(process.env.ZOHO_MAIL_API_URL || 'https://mail.zoho.in').replace(/\/$/, '');
const ZOHO_CLIENT_ID = String(process.env.ZOHO_CLIENT_ID || '').trim();
const ZOHO_CLIENT_SECRET = String(process.env.ZOHO_CLIENT_SECRET || '').trim();
const ZOHO_REFRESH_TOKEN = String(process.env.ZOHO_REFRESH_TOKEN || process.env.ZOHO_OAUTH_REFRESH_TOKEN || '').trim();
const ZOHO_ACCOUNT_ID = String(process.env.ZOHO_ACCOUNT_ID || '').trim();
const ZOHO_FROM = String(process.env.ZOHO_FROM || '').trim();

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

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

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || 'https://indomark.github.io');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Indo-App-Name');
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
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F\u00A0\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim()
    .toLowerCase();
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

function logoHtml() {
  return `<span style="font-size:28px;line-height:1;color:#F97316;font-weight:900;vertical-align:middle">⚡</span><span style="font-size:28px;line-height:1;font-weight:800;color:#F97316;vertical-align:middle;margin-left:7px">Indomark</span>`;
}

function emailShell({ eyebrow = APP_TAGLINE, body, welcome = false }) {
  const footer = welcome
    ? `Automated email from <strong style="color:#F97316">${APP_NAME}</strong>.<br><a href="${APP_URL}" style="color:#F97316;text-decoration:none;font-weight:700">Open Indomark</a>`
    : `Automated email from <strong style="color:#F97316">${APP_NAME}</strong>.<br><span style="color:#6f7f92">This message was sent by the Indomark security system.</span>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#050914;color:#f7fbff;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#050914"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#0a1322;border:1px solid #263756;border-radius:16px;overflow:hidden"><tr><td align="center" style="padding:28px 20px 22px;background:#050914;border-bottom:1px solid #1b2a41">${logoHtml()}<div style="margin-top:10px;color:#99a8bb;font-size:12px;letter-spacing:.7px">${escapeHtml(eyebrow)}</div></td></tr><tr><td style="padding:30px 26px">${body}</td></tr><tr><td align="center" style="padding:18px 20px;background:#07101d;border-top:1px solid #1b2a41;color:#7f8da1;font-size:12px;line-height:1.7">${footer}</td></tr></table></td></tr></table></body></html>`;
}

function cta(label, href = APP_URL) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td align="center" style="border-radius:10px;background:#F97316"><a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 24px;color:#06100b;text-decoration:none;font-weight:800;font-size:14px">${escapeHtml(label)}</a></td></tr></table>`;
}

function otpBox(code) {
  return `<div style="margin:22px 0;padding:20px 16px;background:#0d1829;border:1px solid #263756;border-radius:13px;text-align:center"><div style="font-size:11px;color:#99a8bb;letter-spacing:1.5px;text-transform:uppercase;font-weight:800">Your OTP code</div><div style="margin-top:10px;font-size:34px;line-height:1.2;letter-spacing:9px;font-weight:900;color:#F97316">${escapeHtml(code)}</div></div>`;
}

let zohoToken = null;
let zohoTokenExpiresAt = 0;
async function getZohoAccessToken() {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN || !ZOHO_ACCOUNT_ID || !ZOHO_FROM) {
    throw new Error('Zoho Mail API is not configured.');
  }
  if (zohoToken && Date.now() < zohoTokenExpiresAt - 60_000) return zohoToken;
  const params = new URLSearchParams({ refresh_token: ZOHO_REFRESH_TOKEN, client_id: ZOHO_CLIENT_ID, client_secret: ZOHO_CLIENT_SECRET, grant_type: 'refresh_token' });
  const response = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token?${params.toString()}`, { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(body.error || `Zoho token request failed (${response.status})`);
  zohoToken = body.access_token;
  zohoTokenExpiresAt = Date.now() + Number(body.expires_in || 3600) * 1000;
  return zohoToken;
}

async function sendMail({ to, subject, content }) {
  const recipient = email(to);
  const sender = email(ZOHO_FROM);
  if (!validEmail(recipient)) throw new Error('The recipient email address is invalid after normalization.');
  if (!validEmail(sender)) throw new Error('The configured Zoho sender address is invalid.');

  const token = await getZohoAccessToken();
  const response = await fetch(`${ZOHO_MAIL_API_URL}/api/accounts/${encodeURIComponent(ZOHO_ACCOUNT_ID)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ fromAddress: sender, toAddress: recipient, subject: String(subject || '').trim(), content, mailFormat: 'html' }),
  });
  const body = await response.json().catch(() => ({}));
  const apiCode = body?.status?.code;
  if (!response.ok || (apiCode !== undefined && Number(apiCode) !== 200)) {
    const description = body?.status?.description || body?.message || `Zoho Mail send failed (${response.status})`;
    const recipientDomain = recipient.split('@')[1] || 'unknown-domain';
    console.error(`MAIL SEND FAILED provider=zoho recipientDomain=${recipientDomain}: ${description}`);
    throw new Error(description);
  }
  console.log(`MAIL SEND ACCEPTED provider=zoho recipientDomain=${recipient.split('@')[1] || 'unknown-domain'}`);
  return body;
}

async function mailOtp(to, code, kind) {
  const isSignup = kind === 'signup';
  const title = isSignup ? 'Verify your email' : 'Login verification';
  const intro = isSignup
    ? 'Use the one-time code below to verify your email and create your Indomark account.'
    : 'Use the one-time code below to securely complete your Indomark login.';
  const content = emailShell({
    eyebrow: isSignup ? 'Secure account registration' : 'Secure login verification',
    body: `<h1 style="margin:0 0 10px;color:#f7fbff;font-size:26px;line-height:1.25">${title}</h1><p style="margin:0;color:#c2ccda;font-size:15px;line-height:1.7">${intro}</p>${otpBox(code)}<p style="margin:0;text-align:center;color:#99a8bb;font-size:13px;line-height:1.7">This OTP is valid for <strong style="color:#F97316">${Math.round(OTP_TTL_MS / 60000)} minutes</strong>.<br>Never share this code with anyone.</p><p style="margin:20px 0 0;text-align:center;color:#7f8da1;font-size:12px;line-height:1.6">Didn't request this code? You can safely ignore this email.</p>`,
  });
  await sendMail({ to, subject: isSignup ? `${APP_NAME} • Verify your email` : `${APP_NAME} • Login verification code`, content });
}

async function mailNewAccountWelcome(to, name) {
  const safeName = escapeHtml(name || 'there');
  const content = emailShell({
    eyebrow: APP_TAGLINE,
    welcome: true,
    body: `<h1 style="margin:0 0 10px;color:#f7fbff;font-size:27px">Welcome to <span style="color:#F97316">Indomark</span>! 🎉</h1><p style="margin:0;color:#d4dbe5;font-size:16px;line-height:1.7">Hi ${safeName},</p><p style="margin:8px 0 20px;color:#aab7c8;font-size:15px;line-height:1.7">Your Indomark account has been created successfully. You’re ready to learn, analyse, practice and trade.</p><div style="padding:18px;background:#0d1829;border:1px solid #263756;border-radius:13px"><p style="margin:0 0 10px;color:#F97316;font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase">Your account is ready</p><p style="margin:0;color:#d4dbe5;font-size:14px;line-height:1.7">Track markets, explore stocks, practise strategies and build your investing knowledge from one place.</p></div><div style="margin-top:24px">${cta('Open Indomark')}</div>`,
  });
  await sendMail({ to, subject: `${APP_NAME} • Welcome — your account is ready`, content });
}

async function mailWelcomeBack(to, name) {
  const safeName = escapeHtml(name || 'there');
  const loginTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date());
  const content = emailShell({
    eyebrow: 'Login successful',
    welcome: true,
    body: `<h1 style="margin:0 0 10px;color:#f7fbff;font-size:27px">Welcome <span style="color:#F97316">back</span>! 👋</h1><p style="margin:0;color:#d4dbe5;font-size:16px;line-height:1.7">Hi ${safeName}, you have successfully logged in to your Indomark account.</p><div style="margin:22px 0;padding:17px 18px;background:#0d1829;border:1px solid #263756;border-radius:13px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:5px 0;color:#8fa0b5;font-size:12px">Login time</td><td align="right" style="padding:5px 0;color:#f7fbff;font-size:12px;font-weight:700">${escapeHtml(loginTime)} IST</td></tr><tr><td style="padding:5px 0;color:#8fa0b5;font-size:12px">Account</td><td align="right" style="padding:5px 0;color:#F97316;font-size:12px;font-weight:700">${escapeHtml(to)}</td></tr></table></div><p style="margin:0 0 22px;text-align:center;color:#99a8bb;font-size:12px;line-height:1.6">If this login wasn't you, secure your account through your usual Indomark login flow.</p><div style="margin-top:24px">${cta('Open Indomark')}</div>`,
  });
  await sendMail({ to, subject: `${APP_NAME} • Welcome back — login successful`, content });
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      otp_key TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      challenge_id TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS otp_codes_challenge_id_uq ON otp_codes(challenge_id) WHERE challenge_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS otp_codes_email_purpose_sent_idx ON otp_codes(email, purpose, sent_at DESC);

    CREATE TABLE IF NOT EXISTS signup_welcome_tokens (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS signup_welcome_tokens_email_idx ON signup_welcome_tokens(email, created_at DESC);
    DELETE FROM otp_codes WHERE expires_at < NOW();
    DELETE FROM signup_welcome_tokens WHERE expires_at < NOW();
  `);
}

async function issueOtp(emailAddress, purpose) {
  const recipient = email(emailAddress);
  const latest = await pool.query('SELECT sent_at FROM otp_codes WHERE email=$1 AND purpose=$2 ORDER BY sent_at DESC LIMIT 1', [recipient, purpose]);
  const now = new Date();
  if (latest.rows[0] && now.getTime() - new Date(latest.rows[0].sent_at).getTime() < OTP_RESEND_MS) {
    throw new Error('Please wait before requesting another OTP.');
  }

  await pool.query('DELETE FROM otp_codes WHERE email=$1 AND purpose=$2', [recipient, purpose]);

  const code = generateOtp();
  const challenge = generateToken();
  await pool.query(
    'INSERT INTO otp_codes (otp_key,email,purpose,code_hash,sent_at,expires_at,attempts,challenge_id) VALUES ($1,$2,$3,$4,$5,$6,0,$7)',
    [challenge, recipient, purpose, hash(code), now, new Date(now.getTime() + OTP_TTL_MS), 0, challenge],
  );

  try {
    await mailOtp(recipient, code, purpose);
  } catch (error) {
    await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [challenge]).catch(() => {});
    throw error;
  }
  return challenge;
}

async function verifyOtp(challengeId, emailAddress, submittedOtp) {
  const key = String(challengeId || '').trim();
  const recipient = email(emailAddress);
  const result = await pool.query('SELECT * FROM otp_codes WHERE challenge_id=$1 AND email=$2 LIMIT 1', [key, recipient]);
  const item = result.rows[0];
  if (!item) throw new Error('OTP not found or expired.');
  if (Date.now() > new Date(item.expires_at).getTime()) {
    await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [item.otp_key]);
    throw new Error('OTP expired.');
  }
  if (item.attempts >= OTP_MAX_ATTEMPTS) {
    await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [item.otp_key]);
    throw new Error('Too many incorrect attempts.');
  }

  const submitted = normalizeOtp(submittedOtp);
  const submittedHash = hash(submitted);
  if (!/^\d{6}$/.test(submitted) || !sameHash(submittedHash, item.code_hash)) {
    await pool.query('UPDATE otp_codes SET attempts=attempts+1 WHERE otp_key=$1', [item.otp_key]);
    throw new Error('Invalid OTP.');
  }

  await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [item.otp_key]);
  return item;
}

async function createSignupWelcomeToken(emailAddress, name) {
  const recipient = email(emailAddress);
  const token = generateToken();
  await pool.query('DELETE FROM signup_welcome_tokens WHERE email=$1 AND used_at IS NULL', [recipient]);
  await pool.query(
    'INSERT INTO signup_welcome_tokens (token_hash,email,name,created_at,expires_at) VALUES ($1,$2,$3,NOW(),$4)',
    [hash(token), recipient, String(name || '').trim(), new Date(Date.now() + WELCOME_TOKEN_TTL_MS)],
  );
  return token;
}

async function consumeSignupWelcomeToken(token, emailAddress, name) {
  const recipient = email(emailAddress);
  const result = await pool.query('SELECT * FROM signup_welcome_tokens WHERE token_hash=$1 AND email=$2 LIMIT 1', [hash(token), recipient]);
  const item = result.rows[0];
  if (!item) throw new Error('Welcome email authorization expired.');
  if (item.used_at) throw new Error('Welcome email has already been sent.');
  if (Date.now() > new Date(item.expires_at).getTime()) {
    await pool.query('DELETE FROM signup_welcome_tokens WHERE token_hash=$1', [hash(token)]);
    throw new Error('Welcome email authorization expired.');
  }

  const resolvedName = String(name || item.name || 'there').trim();
  await mailNewAccountWelcome(recipient, resolvedName);
  await pool.query('UPDATE signup_welcome_tokens SET used_at=NOW() WHERE token_hash=$1 AND used_at IS NULL', [hash(token)]);
  return true;
}

async function main(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        service: 'IndoVerification',
        role: 'OTP service only',
        emailProvider: 'Zoho Mail API',
        emailConfigured: Boolean(ZOHO_CLIENT_ID && ZOHO_CLIENT_SECRET && ZOHO_REFRESH_TOKEN && ZOHO_ACCOUNT_ID && ZOHO_FROM),
        time: new Date().toISOString(),
      });
    }

    const body = await readBody(req);

    if (url.pathname === '/api/auth/signup/request-otp' && req.method === 'POST') {
      const e = email(body.email);
      const name = String(body.name || '').trim();
      if (!name || !validEmail(e)) return sendJson(res, 400, { ok: false, error: 'Name and a valid email are required.' });
      const challengeId = await issueOtp(e, 'signup');
      return sendJson(res, 200, { ok: true, message: 'OTP sent to your email.', challengeId });
    }

    if (url.pathname === '/api/auth/signup/verify-otp' && req.method === 'POST') {
      const e = email(body.email);
      if (!validEmail(e)) return sendJson(res, 400, { ok: false, error: 'Enter a valid email.' });
      const verification = await verifyOtp(body.challengeId, e, body.otp);
      if (verification.purpose !== 'signup') return sendJson(res, 400, { ok: false, error: 'OTP request mismatch.' });
      const name = String(body.name || '').trim();
      const welcomeToken = await createSignupWelcomeToken(e, name);
      return sendJson(res, 200, { ok: true, verified: true, email: e, name, welcomeToken });
    }

    if (url.pathname === '/api/auth/signup/welcome' && req.method === 'POST') {
      const e = email(body.email);
      if (!validEmail(e)) return sendJson(res, 400, { ok: false, error: 'Enter a valid email.' });
      await consumeSignupWelcomeToken(String(body.welcomeToken || ''), e, String(body.name || '').trim());
      return sendJson(res, 200, { ok: true, welcomeSent: true });
    }

    if (url.pathname === '/api/auth/login/request-otp' && req.method === 'POST') {
      const e = email(body.email);
      if (!validEmail(e)) return sendJson(res, 400, { ok: false, error: 'Enter a valid email.' });
      const challengeId = await issueOtp(e, 'login');
      return sendJson(res, 200, { ok: true, message: 'OTP sent to your email.', challengeId });
    }

    if (url.pathname === '/api/auth/login/verify-otp' && req.method === 'POST') {
      const e = email(body.email);
      if (!validEmail(e)) return sendJson(res, 400, { ok: false, error: 'Enter a valid email.' });
      const verification = await verifyOtp(body.challengeId, e, body.otp);
      if (verification.purpose !== 'login') return sendJson(res, 400, { ok: false, error: 'OTP request mismatch.' });
      const name = String(body.name || '').trim();
      let welcomeSent = true;
      try {
        await mailWelcomeBack(e, name);
      } catch (welcomeError) {
        welcomeSent = false;
        console.error('Welcome-back email failed:', welcomeError instanceof Error ? welcomeError.message : welcomeError);
      }
      return sendJson(res, 200, { ok: true, verified: true, email: e, welcomeSent });
    }

    if (url.pathname === '/api/auth/resend-otp' && req.method === 'POST') {
      const e = email(body.email);
      const purpose = String(body.purpose || 'signup');
      if (!validEmail(e)) return sendJson(res, 400, { ok: false, error: 'Enter a valid email.' });
      if (!['signup', 'login'].includes(purpose)) return sendJson(res, 400, { ok: false, error: 'Invalid OTP purpose.' });
      const challengeId = await issueOtp(e, purpose);
      return sendJson(res, 200, { ok: true, message: 'OTP resent.', challengeId });
    }

    return sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    console.error('REQUEST ERROR:', error);
    const message = error instanceof Error ? error.message : 'Server error';
    const isEmailFailure = /Zoho Mail API|Zoho token|Zoho Mail send|email is not configured|configured Zoho sender|recipient email address/i.test(message);
    const status = isEmailFailure ? 503 : 400;
    return sendJson(res, status, { ok: false, error: message });
  }
}

initDb().then(() => {
  http.createServer(main).listen(PORT, HOST, () => console.log(`IndoVerification OTP service listening on ${HOST}:${PORT}`));
}).catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
