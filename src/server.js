import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const OTP_TTL_MS = Math.max(60, Number(process.env.OTP_TTL_SECONDS || 600)) * 1000;
const OTP_RESEND_MS = Math.max(15, Number(process.env.OTP_RESEND_SECONDS || 60)) * 1000;
const OTP_MAX_ATTEMPTS = Math.max(1, Number(process.env.OTP_MAX_ATTEMPTS || 5));
const ZOHO_ACCOUNTS_URL = String(process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in').replace(/\/$/, '');
const ZOHO_MAIL_API_URL = String(process.env.ZOHO_MAIL_API_URL || 'https://mail.zoho.in').replace(/\/$/, '');
const ZOHO_CLIENT_ID = String(process.env.ZOHO_CLIENT_ID || '').trim();
const ZOHO_CLIENT_SECRET = String(process.env.ZOHO_CLIENT_SECRET || '').trim();
const ZOHO_REFRESH_TOKEN = String(process.env.ZOHO_REFRESH_TOKEN || '').trim();
const ZOHO_ACCOUNT_ID = String(process.env.ZOHO_ACCOUNT_ID || '').trim();
const ZOHO_FROM = String(process.env.ZOHO_FROM || process.env.SMTP_FROM || '').trim();

if (!JWT_SECRET) { console.error('JWT_SECRET is required.'); process.exit(1); }
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
function otp() { return String(crypto.randomInt(100000, 1000000)); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function passwordOk(password, record) {
  const derived = crypto.scryptSync(String(password || ''), record.salt, 64);
  const expected = Buffer.from(record.hash, 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}
function tokenFor(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d', issuer: 'IndoVerification' });
}
function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, active: user.active !== false };
}

let zohoToken = null;
let zohoTokenExpiresAt = 0;
async function getZohoAccessToken() {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN || !ZOHO_ACCOUNT_ID || !ZOHO_FROM) {
    throw new Error('Zoho Mail API is not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ACCOUNT_ID and ZOHO_FROM.');
  }
  if (zohoToken && Date.now() < zohoTokenExpiresAt - 60000) return zohoToken;
  const params = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const response = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token?${params.toString()}`, { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(body.error || `Zoho token request failed (${response.status})`);
  }
  zohoToken = body.access_token;
  zohoTokenExpiresAt = Date.now() + Number(body.expires_in || 3600) * 1000;
  return zohoToken;
}
async function sendMail({ to, subject, content }) {
  const token = await getZohoAccessToken();
  const response = await fetch(`${ZOHO_MAIL_API_URL}/api/accounts/${encodeURIComponent(ZOHO_ACCOUNT_ID)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ fromAddress: ZOHO_FROM, toAddress: to, subject, content, mailFormat: 'plaintext' }),
  });
  const body = await response.json().catch(() => ({}));
  const apiCode = body?.status?.code;
  if (!response.ok || (apiCode !== undefined && Number(apiCode) !== 200)) {
    throw new Error(body?.status?.description || body?.message || `Zoho Mail send failed (${response.status})`);
  }
  return body;
}
async function mailOtp(to, code, purpose) {
  await sendMail({
    to,
    subject: `IndoVerification ${purpose} OTP`,
    content: `Your IndoVerification OTP is ${code}. It expires in ${Math.round(OTP_TTL_MS / 60000)} minutes. Do not share this code with anyone.`,
  });
}
async function mailWelcome(to, name, event) {
  const firstName = String(name || '').trim().split(/\s+/)[0] || 'there';
  const isSignup = event === 'signup';
  await sendMail({
    to,
    subject: isSignup ? 'Welcome to IndoVerification' : 'Welcome back to IndoVerification',
    content: isSignup
      ? `Hi ${firstName},\n\nWelcome to IndoVerification! Your account has been created successfully and your email has been verified.\n\nYou can now use your IndoVerification account to sign in securely with email OTP verification.\n\nIf you did not create this account, please contact support immediately.\n\nRegards,\nIndoVerification`
      : `Hi ${firstName},\n\nWelcome back! You have successfully signed in to your IndoVerification account.\n\nFor your security, every login requires email OTP verification.\n\nIf this login was not you, please reset your password and contact support immediately.\n\nRegards,\nIndoVerification`,
  });
}
async function safeWelcome(to, name, event) {
  try { await mailWelcome(to, name, event); }
  catch (error) { console.error(`Welcome email failed for ${to}:`, error); }
}
async function issueOtp(key, emailAddress, purpose) {
  const previous = await pool.query('SELECT sent_at FROM otp_codes WHERE otp_key=$1', [key]);
  const now = new Date();
  if (previous.rows[0] && now.getTime() - new Date(previous.rows[0].sent_at).getTime() < OTP_RESEND_MS) {
    throw new Error('Please wait before requesting another OTP.');
  }
  const code = otp();
  await pool.query(
    `INSERT INTO otp_codes (otp_key,email,purpose,code_hash,sent_at,expires_at,attempts)
     VALUES ($1,$2,$3,$4,$5,$6,0)
     ON CONFLICT (otp_key) DO UPDATE SET email=EXCLUDED.email,purpose=EXCLUDED.purpose,code_hash=EXCLUDED.code_hash,sent_at=EXCLUDED.sent_at,expires_at=EXCLUDED.expires_at,attempts=0`,
    [key, emailAddress, purpose, hash(code), now, new Date(now.getTime() + OTP_TTL_MS)],
  );
  return code;
}
async function verifyOtp(key, value) {
  const result = await pool.query('SELECT * FROM otp_codes WHERE otp_key=$1', [key]);
  const item = result.rows[0];
  if (!item) throw new Error('OTP not found or expired.');
  if (Date.now() > new Date(item.expires_at).getTime()) {
    await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [key]);
    throw new Error('OTP expired.');
  }
  if (item.attempts >= OTP_MAX_ATTEMPTS) {
    await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [key]);
    throw new Error('Too many incorrect attempts.');
  }
  if (hash(value) !== item.code_hash) {
    await pool.query('UPDATE otp_codes SET attempts=attempts+1 WHERE otp_key=$1', [key]);
    throw new Error('Invalid OTP.');
  }
  await pool.query('DELETE FROM otp_codes WHERE otp_key=$1', [key]);
  return item;
}
async function authUser(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) throw new Error('Authorization required.');
  let payload;
  try { payload = jwt.verify(header.slice(7), JWT_SECRET, { issuer: 'IndoVerification' }); }
  catch { throw new Error('Invalid or expired session.'); }
  const result = await pool.query('SELECT * FROM users WHERE id=$1 AND email=$2', [payload.sub, payload.email]);
  const user = result.rows[0];
  if (!user) throw new Error('Account not found.');
  return user;
}
function requireActive(user) { if (user.active === false) throw new Error('Account is inactive.'); }

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS otp_codes (
      otp_key TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
  `);
}

async function main(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (u.pathname === '/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, service: 'IndoVerification', emailProvider: 'Zoho Mail API', time: new Date().toISOString() });
    }
    const body = await readBody(req);

    if (u.pathname === '/api/auth/signup/request-otp' && req.method === 'POST') {
      const e = email(body.email), name = String(body.name || '').trim(), password = String(body.password || '');
      if (!name || !/^\S+@\S+\.\S+$/.test(e) || password.length < 8) return sendJson(res, 400, { error: 'Name, valid email and password (8+ chars) are required.' });
      const existing = await pool.query('SELECT 1 FROM users WHERE email=$1', [e]);
      if (existing.rowCount) return sendJson(res, 409, { error: 'Account already exists.' });
      const code = await issueOtp(`signup:${e}`, e, 'signup');
      await mailOtp(e, code, 'signup verification');
      return sendJson(res, 200, { ok: true, message: 'OTP sent to your email.' });
    }

    if (u.pathname === '/api/auth/signup/verify-otp' && req.method === 'POST') {
      const e = email(body.email), verification = await verifyOtp(`signup:${e}`, body.otp), name = String(body.name || '').trim(), password = String(body.password || '');
      if (verification.email !== e) return sendJson(res, 400, { error: 'OTP request mismatch.' });
      if (!name || password.length < 8) return sendJson(res, 400, { error: 'Invalid signup data.' });
      const p = passwordHash(password);
      const user = { id: crypto.randomUUID(), email: e, name, password_salt: p.salt, password_hash: p.hash, active: true };
      await pool.query('INSERT INTO users (id,email,name,password_salt,password_hash,active) VALUES ($1,$2,$3,$4,$5,true)', [user.id, user.email, user.name, user.password_salt, user.password_hash]);
      await safeWelcome(e, name, 'signup');
      return sendJson(res, 201, { ok: true, token: tokenFor(user), user: publicUser(user) });
    }

    if (u.pathname === '/api/auth/login/request-otp' && req.method === 'POST') {
      const e = email(body.email), password = String(body.password || '');
      const result = await pool.query('SELECT * FROM users WHERE email=$1', [e]);
      const user = result.rows[0];
      if (!user || !passwordOk(password, { salt: user.password_salt, hash: user.password_hash })) return sendJson(res, 401, { error: 'Invalid email or password.' });
      requireActive(user);
      const code = await issueOtp(`login:${e}`, e, 'login');
      await mailOtp(e, code, 'login verification');
      return sendJson(res, 200, { ok: true, message: 'OTP sent to your email.' });
    }

    if (u.pathname === '/api/auth/login/verify-otp' && req.method === 'POST') {
      const e = email(body.email), verification = await verifyOtp(`login:${e}`, body.otp);
      const result = await pool.query('SELECT * FROM users WHERE email=$1', [e]);
      const user = result.rows[0];
      if (verification.email !== e || !user) return sendJson(res, 401, { error: 'Verification failed.' });
      requireActive(user);
      await safeWelcome(e, user.name, 'login');
      return sendJson(res, 200, { ok: true, token: tokenFor(user), user: publicUser(user) });
    }

    if (u.pathname === '/api/auth/resend-otp' && req.method === 'POST') {
      const e = email(body.email), purpose = String(body.purpose || 'signup');
      if (!['signup', 'login'].includes(purpose)) return sendJson(res, 400, { error: 'Invalid OTP purpose.' });
      const result = await pool.query('SELECT active FROM users WHERE email=$1', [e]);
      const user = result.rows[0];
      if (purpose === 'signup' && user) return sendJson(res, 409, { error: 'Account already exists.' });
      if (purpose === 'login' && (!user || user.active === false)) return sendJson(res, 404, { error: 'Account not available for login.' });
      const code = await issueOtp(`${purpose}:${e}`, e, purpose);
      await mailOtp(e, code, purpose);
      return sendJson(res, 200, { ok: true, message: 'OTP resent.' });
    }

    const actionMatch = u.pathname.match(/^\/api\/account\/(activate|deactivate|delete)\/(request-otp|verify-otp)$/);
    if (actionMatch && req.method === 'POST') {
      const action = actionMatch[1], step = actionMatch[2], user = await authUser(req), key = `account:${user.id}:${action}`;
      if (step === 'request-otp') {
        const code = await issueOtp(key, user.email, action);
        await mailOtp(user.email, code, `${action} account`);
        return sendJson(res, 200, { ok: true, message: 'OTP sent to your email.' });
      }
      const verification = await verifyOtp(key, body.otp);
      if (verification.email !== user.email) return sendJson(res, 400, { error: 'OTP request mismatch.' });
      if (action === 'activate') {
        await pool.query('UPDATE users SET active=true WHERE id=$1', [user.id]);
        return sendJson(res, 200, { ok: true, message: 'Account activated.', active: true });
      }
      if (action === 'deactivate') {
        await pool.query('UPDATE users SET active=false WHERE id=$1', [user.id]);
        return sendJson(res, 200, { ok: true, message: 'Account deactivated.', active: false });
      }
      await pool.query('DELETE FROM users WHERE id=$1', [user.id]);
      return sendJson(res, 200, { ok: true, message: 'Account permanently deleted.' });
    }

    if (u.pathname === '/api/auth/forgot-password/request-otp' && req.method === 'POST') {
      const e = email(body.email), result = await pool.query('SELECT 1 FROM users WHERE email=$1', [e]);
      if (!result.rowCount) return sendJson(res, 404, { error: 'Account not found.' });
      const code = await issueOtp(`forgot:${e}`, e, 'password reset');
      await mailOtp(e, code, 'password reset');
      return sendJson(res, 200, { ok: true, message: 'OTP sent to your email.' });
    }

    if (u.pathname === '/api/auth/forgot-password/verify-otp' && req.method === 'POST') {
      const e = email(body.email), password = String(body.newPassword || '');
      if (password.length < 8) return sendJson(res, 400, { error: 'New password must be at least 8 characters.' });
      const verification = await verifyOtp(`forgot:${e}`, body.otp);
      if (verification.email !== e) return sendJson(res, 400, { error: 'Verification failed.' });
      const p = passwordHash(password);
      const result = await pool.query('UPDATE users SET password_salt=$1,password_hash=$2 WHERE email=$3 RETURNING id', [p.salt, p.hash, e]);
      if (!result.rowCount) return sendJson(res, 400, { error: 'Verification failed.' });
      return sendJson(res, 200, { ok: true, message: 'Password reset successfully.' });
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Server error';
    const status = /Authorization|required|session/i.test(message) ? 401 : /already exists/i.test(message) ? 409 : /OTP|account|password|Zoho Mail API/i.test(message) ? 400 : 500;
    return sendJson(res, status, { error: message });
  }
}

initDb().then(() => {
  http.createServer(main).listen(PORT, HOST, () => console.log(`IndoVerification listening on ${HOST}:${PORT}`));
}).catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
