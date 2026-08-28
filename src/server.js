import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const OTP_TTL_MS = Math.max(60, Number(process.env.OTP_TTL_SECONDS || 600)) * 1000;
const OTP_RESEND_MS = Math.max(15, Number(process.env.OTP_RESEND_SECONDS || 60)) * 1000;
const OTP_MAX_ATTEMPTS = Math.max(1, Number(process.env.OTP_MAX_ATTEMPTS || 5));
const ZOHO_ACCOUNTS_URL = String(process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in').replace(/\/$/, '');
const ZOHO_MAIL_API_URL = String(process.env.ZOHO_MAIL_API_URL || 'https://mail.zoho.in').replace(/\/$/, '');
const ZOHO_CLIENT_ID = String(process.env.ZOHO_CLIENT_ID || '').trim();
const ZOHO_CLIENT_SECRET = String(process.env.ZOHO_CLIENT_SECRET || '').trim();
const ZOHO_REFRESH_TOKEN = String(process.env.ZOHO_REFRESH_TOKEN || process.env.ZOHO_OAUTH_REFRESH_TOKEN || '').trim();
const ZOHO_ACCOUNT_ID = String(process.env.ZOHO_ACCOUNT_ID || '').trim();
const ZOHO_FROM = String(process.env.ZOHO_FROM || '').trim();

if (!DATABASE_URL) { console.error('DATABASE_URL is required.'); process.exit(1); }

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
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Indo-App-Name');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1000000) throw new Error('Request too large');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('Invalid JSON'); }
}
function email(value) { return String(value || '').trim().toLowerCase(); }
function normalizeOtp(value) { return String(value || '').normalize('NFKC').replace(/[^0-9]/g, '').slice(0, 6); }
function otp() { return String(crypto.randomInt(100000, 1000000)); }
function challengeId() { return crypto.randomBytes(24).toString('hex'); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function appName(req) {
  const raw = String(req.headers['x-indo-app-name'] || 'Indomark').trim().replace(/[<>\"'`]/g, '');
  return raw ? raw.slice(0, 80) : 'Indomark';
}
function escapeHtml(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\"', '&quot;').replaceAll("'", '&#39;');
}
function emailShell({ brand, title, subtitle, body }) {
  const safeBrand = escapeHtml(brand);
  return `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#18212f"><div style="max-width:640px;margin:30px auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,.12)"><div style="background:#0b1020;padding:28px 24px;text-align:center"><div style="font-size:30px;font-weight:800;color:#fff">⚡ <span>${safeBrand}</span></div><div style="margin-top:8px;color:#94a3b8;font-size:14px">${escapeHtml(subtitle || title)}</div></div><div style="padding:34px 28px">${body}</div><div style="background:#0b1020;color:#94a3b8;padding:18px 24px;text-align:center;font-size:12px">This is an automated email from ${safeBrand}.<br>© ${new Date().getFullYear()} ${safeBrand}</div></div></body></html>`;
}

let zohoToken = null;
let zohoTokenExpiresAt = 0;
async function getZohoAccessToken() {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN || !ZOHO_ACCOUNT_ID || !ZOHO_FROM) {
    throw new Error('Zoho Mail API is not configured.');
  }
  if (zohoToken && Date.now() < zohoTokenExpiresAt - 60000) return zohoToken;
  const params = new URLSearchParams({ refresh_token: ZOHO_REFRESH_TOKEN, client_id: ZOHO_CLIENT_ID, client_secret: ZOHO_CLIENT_SECRET, grant_type: 'refresh_token' });
  const response = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token?${params.toString()}`, { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(body.error || `Zoho token request failed (${response.status})`);
  zohoToken = body.access_token;
  zohoTokenExpiresAt = Date.now() + Number(body.expires_in || 3600) * 1000;
  return zohoToken;
}
async function sendMail({ to, subject, content }) {
  const token = await getZohoAccessToken();
  const response = await fetch(`${ZOHO_MAIL_API_URL}/api/accounts/${encodeURIComponent(ZOHO_ACCOUNT_ID)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ fromAddress: ZOHO_FROM, toAddress: to, subject, content, mailFormat: 'html' }),
  });
  const body = await response.json().catch(() => ({}));
  const apiCode = body?.status?.code;
  if (!response.ok || (apiCode !== undefined && Number(apiCode) !== 200)) throw new Error(body?.status?.description || body?.message || `Zoho Mail send failed (${response.status})`);
  return body;
}
async function mailOtp(to, code, purpose, brand) {
  const safeBrand = escapeHtml(brand);
  const safePurpose = escapeHtml(purpose);
  const content = emailShell({
    brand,
    title: 'Verify your email',
    subtitle: 'Secure account verification',
    body: `<h2 style="margin:0 0 10px">Verify your email</h2><p style="font-size:16px;line-height:1.6">Use this code to continue with your ${safePurpose.toLowerCase()}.</p><div style="background:#f1f5f9;border:1px solid #dbe3ec;border-radius:16px;padding:24px;text-align:center;margin:24px 0"><div style="font-size:13px;color:#64748b;font-weight:700;letter-spacing:1.6px;text-transform:uppercase">Your OTP</div><div style="font-size:42px;letter-spacing:10px;font-weight:900;color:#16a36d;margin-top:10px">${escapeHtml(code)}</div></div><p style="color:#475569">This code expires in ${Math.round(OTP_TTL_MS / 60000)} minutes.</p><p style="background:#ecfdf5;border:1px solid #a7f3d0;padding:14px;border-radius:12px;color:#14532d"><strong>Security tip:</strong> Never share this OTP with anyone.</p><p style="font-size:12px;color:#64748b;margin-top:24px">Automated security email from ${safeBrand}.</p>`,
  });
  await sendMail({ to, subject: `${brand} ${purpose} OTP`, content });
}
async function mailWelcome(to, name, brand) {
  const safeBrand = escapeHtml(brand);
  const safeName = escapeHtml(name || 'there');
  const content = emailShell({
    brand,
    title: `Welcome to ${brand}!`,
    subtitle: 'Welcome to your account',
    body: `<h1 style="margin:0 0 14px;color:#14213d">Welcome to ${safeBrand}! 🎉</h1><p style="font-size:17px;line-height:1.7;color:#334155;margin:0 0 8px">Hi ${safeName},</p><p style="font-size:16px;line-height:1.7;color:#475569">Your login was verified successfully. Welcome aboard — your ${safeBrand} account is ready to use.</p><div style="margin:26px 0;padding:20px;border:1px solid #bcead6;background:#ecfdf5;border-radius:16px"><div style="font-size:13px;font-weight:800;letter-spacing:.8px;color:#16865b;text-transform:uppercase">Account ready</div><div style="font-size:18px;font-weight:800;color:#14532d;margin-top:7px">You can now start using ${safeBrand}.</div></div><div style="text-align:center;margin:28px 0"><a href="https://indomark.github.io/Indomark/" style="display:inline-block;background:#16a36d;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:800">Open ${safeBrand}</a></div><hr style="border:0;border-top:1px solid #e2e8f0;margin:28px 0"><p style="font-size:13px;color:#475569;line-height:1.6">Need help? Contact support at <a href="mailto:indomark@zohomail.in" style="color:#16865b;font-weight:700;text-decoration:none">indomark@zohomail.in</a></p>`,
  });
  await sendMail({ to, subject: `Welcome to ${brand}! 🎉`, content });
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
      attempts INTEGER NOT NULL DEFAULT 0
    );
    ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS challenge_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS otp_codes_challenge_id_uq ON otp_codes(challenge_id) WHERE challenge_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS otp_codes_email_purpose_sent_idx ON otp_codes(email, purpose, sent_at DESC);
    DELETE FROM otp_codes WHERE expires_at < NOW();
  `);
}
async function issueOtp(emailAddress, purpose, brand) {
  const latest = await pool.query('SELECT sent_at FROM otp_codes WHERE email=$1 AND purpose=$2 ORDER BY sent_at DESC LIMIT 1', [emailAddress, purpose]);
  const now = new Date();
  if (latest.rows[0] && now.getTime() - new Date(latest.rows[0].sent_at).getTime() < OTP_RESEND_MS) {
    throw new Error('Please wait before requesting another OTP.');
  }
  const code = otp();
  const id = challengeId();
  await pool.query('INSERT INTO otp_codes (otp_key,email,purpose,code_hash,sent_at,expires_at,attempts,challenge_id) VALUES ($1,$2,$3,$4,$5,$6,0,$7)', [id, emailAddress, purpose, hash(code), now, new Date(now.getTime() + OTP_TTL_MS), id]);
  try {
    await mailOtp(emailAddress, code, purpose === 'signup' ? 'Account creation' : 'Login verification', brand);
  } catch (error) {
    await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [id]).catch(() => {});
    throw error;
  }
  return id;
}
async function verifyOtp(challenge, emailAddress, value) {
  const key = String(challenge || '').trim();
  if (!key) throw new Error('OTP challenge is required.');
  const result = await pool.query('SELECT * FROM otp_codes WHERE challenge_id=$1 AND email=$2 LIMIT 1', [key, emailAddress]);
  const item = result.rows[0];
  if (!item) throw new Error('OTP not found or expired.');
  if (Date.now() > new Date(item.expires_at).getTime()) { await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [item.otp_key]); throw new Error('OTP expired.'); }
  if (item.attempts >= OTP_MAX_ATTEMPTS) { await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [item.otp_key]); throw new Error('Too many incorrect attempts.'); }
  const submitted = normalizeOtp(value);
  if (!/^\d{6}$/.test(submitted) || hash(submitted) !== item.code_hash) {
    await pool.query('UPDATE otp_codes SET attempts=attempts+1 WHERE otp_key=$1', [item.otp_key]);
    throw new Error('Invalid OTP.');
  }
  await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [item.otp_key]);
  return item;
}

async function main(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (u.pathname === '/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, service: 'IndoVerification', role: 'OTP service only', emailProvider: 'Zoho Mail API', time: new Date().toISOString() });
    }
    const body = await readBody(req);

    if (u.pathname === '/api/auth/signup/request-otp' && req.method === 'POST') {
      const e = email(body.email), name = String(body.name || '').trim();
      if (!name || !/^\S+@\S+\.\S+$/.test(e)) return sendJson(res, 400, { error: 'Name and a valid email are required.' });
      const challenge = await issueOtp(e, 'signup', appName(req));
      return sendJson(res, 200, { ok: true, message: 'OTP sent to your email.', challengeId: challenge });
    }

    if (u.pathname === '/api/auth/signup/verify-otp' && req.method === 'POST') {
      const e = email(body.email);
      const verification = await verifyOtp(body.challengeId, e, body.otp);
      if (verification.email !== e || verification.purpose !== 'signup') return sendJson(res, 400, { error: 'OTP request mismatch.' });
      return sendJson(res, 200, { ok: true, verified: true, email: e, name: String(body.name || '').trim() });
    }

    if (u.pathname === '/api/auth/login/request-otp' && req.method === 'POST') {
      const e = email(body.email);
      if (!/^\S+@\S+\.\S+$/.test(e)) return sendJson(res, 400, { error: 'Enter a valid email.' });
      const challenge = await issueOtp(e, 'login', appName(req));
      return sendJson(res, 200, { ok: true, message: 'OTP sent to your email.', challengeId: challenge });
    }

    if (u.pathname === '/api/auth/login/verify-otp' && req.method === 'POST') {
      const e = email(body.email);
      const verification = await verifyOtp(body.challengeId, e, body.otp);
      if (verification.email !== e || verification.purpose !== 'login') return sendJson(res, 400, { error: 'OTP request mismatch.' });
      const name = String(body.name || '').trim();
      let welcomeSent = true;
      try {
        await mailWelcome(e, name, appName(req));
      } catch (welcomeError) {
        welcomeSent = false;
        console.error('Welcome email failed:', welcomeError);
      }
      return sendJson(res, 200, { ok: true, verified: true, email: e, welcomeSent });
    }

    if (u.pathname === '/api/auth/resend-otp' && req.method === 'POST') {
      const e = email(body.email), purpose = String(body.purpose || 'signup');
      if (!['signup', 'login'].includes(purpose)) return sendJson(res, 400, { error: 'Invalid OTP purpose.' });
      const challenge = await issueOtp(e, purpose, appName(req));
      return sendJson(res, 200, { ok: true, message: 'OTP resent.', challengeId: challenge });
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Server error';
    const status = /OTP|Zoho Mail API|Zoho token|Zoho Mail send/i.test(message) ? 400 : 500;
    return sendJson(res, status, { error: message });
  }
}

initDb().then(() => {
  http.createServer(main).listen(PORT, HOST, () => console.log(`IndoVerification OTP service listening on ${HOST}:${PORT}`));
}).catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
