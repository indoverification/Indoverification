import http from 'node:http';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import 'dotenv/config';

// Accept a dedicated Railway variable so stale ZOHO_REFRESH_TOKEN references can be bypassed.
if (!String(process.env.ZOHO_REFRESH_TOKEN || '').trim() && String(process.env.ZOHO_OAUTH_REFRESH_TOKEN || '').trim()) {
  process.env.ZOHO_REFRESH_TOKEN = String(process.env.ZOHO_OAUTH_REFRESH_TOKEN).trim();
}

const originalCreateServer = http.createServer.bind(http);
const originalFetch = globalThis.fetch.bind(globalThis);
const stateStore = new Map();
const appContext = new AsyncLocalStorage();
const DEFAULT_APP_NAME = 'Indomark';
const ACCOUNTS_URL = String(process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in').replace(/\/$/, '');
const MAIL_API_URL = String(process.env.ZOHO_MAIL_API_URL || 'https://mail.zoho.in').replace(/\/$/, '');
const CLIENT_ID = String(process.env.ZOHO_CLIENT_ID || '').trim();
const CLIENT_SECRET = String(process.env.ZOHO_CLIENT_SECRET || '').trim();
const REDIRECT_URI = String(process.env.ZOHO_REDIRECT_URI || 'https://indoverification-production.up.railway.app/api/zoho/oauth/callback').trim();

function safeAppName(value) {
  const name = String(value || '').trim().replace(/[<>"'`]/g, '');
  return name ? name.slice(0, 80) : DEFAULT_APP_NAME;
}
function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function firstNameFromContent(content) {
  const match = String(content || '').match(/Hi\s+([^,\n<]+)/i);
  return String(match?.[1] || 'there').trim() || 'there';
}
function buildBrandedHtml({ appName, subject, plainContent }) {
  const name = escapeHtml(appName);
  const safeSubject = escapeHtml(subject);
  const raw = String(plainContent || '');
  const otpMatch = raw.match(/\b(\d{6})\b/);
  const isOtp = /otp/i.test(raw) || /otp/i.test(subject);
  const firstName = escapeHtml(firstNameFromContent(raw));
  const ttlMatch = raw.match(/expires? in ([^.\n]+)/i);
  const expiry = escapeHtml(ttlMatch?.[1] || '10 minutes');
  const paragraphs = raw.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);

  if (isOtp && otpMatch) {
    const code = escapeHtml(otpMatch[1]);
    return `<!doctype html><html><body style="margin:0;background:#0b1020;font-family:Arial,Helvetica,sans-serif;color:#18212f;">
      <div style="max-width:640px;margin:32px auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 16px 40px rgba(0,0,0,.22)">
        <div style="background:#0b1020;padding:28px 24px;text-align:center;border-bottom:1px solid #1e293b">
          <div style="font-size:30px;font-weight:800;color:#ffffff">⚡ <span style="color:#ffffff">${name}</span></div>
          <div style="margin-top:8px;color:#94a3b8;font-size:14px">Secure account verification</div>
        </div>
        <div style="padding:34px 28px">
          <div style="font-size:28px;font-weight:800;margin-bottom:12px">Verify your email</div>
          <p style="font-size:16px;line-height:1.6;margin:0 0 18px">Hi ${firstName}, use the verification code below to continue securely.</p>
          <div style="background:#f1f5f9;border:1px solid #dbe3ec;border-radius:16px;padding:24px;text-align:center;margin:24px 0">
            <div style="font-size:13px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:1.6px">Your OTP</div>
            <div style="font-size:42px;letter-spacing:10px;font-weight:900;color:#16a36d;margin-top:10px">${code}</div>
          </div>
          <div style="text-align:center;color:#475569;font-size:14px;margin-bottom:22px">⏱ This code expires in <strong>${expiry}</strong>.</div>
          <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:14px;padding:16px 18px;font-size:14px;line-height:1.6;color:#14532d"><strong>Security tip:</strong> Never share this OTP with anyone. ${name} will never ask you for your OTP.</div>
        </div>
        <div style="background:#0b1020;color:#94a3b8;padding:20px 24px;text-align:center;font-size:12px">This is an automated security email from ${name}.<br>© ${new Date().getFullYear()} ${name}</div>
      </div>
    </body></html>`;
  }

  const body = paragraphs.map((part) => `<p style="font-size:16px;line-height:1.65;margin:0 0 18px">${escapeHtml(part).replaceAll('\n', '<br>')}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#0b1020;font-family:Arial,Helvetica,sans-serif;color:#18212f;">
    <div style="max-width:640px;margin:32px auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 16px 40px rgba(0,0,0,.22)">
      <div style="background:#0b1020;padding:28px 24px;text-align:center"><div style="font-size:30px;font-weight:800;color:#ffffff">⚡ ${name}</div><div style="margin-top:8px;color:#94a3b8;font-size:14px">${safeSubject}</div></div>
      <div style="padding:34px 28px">${body}<div style="margin-top:24px;color:#16a36d;font-weight:700">Thanks,<br>The ${name} Team</div></div>
      <div style="background:#0b1020;color:#94a3b8;padding:20px 24px;text-align:center;font-size:12px">This is an automated email from ${name}.<br>© ${new Date().getFullYear()} ${name}</div>
    </div>
  </body></html>`;
}

// Rebrand outgoing Zoho Mail messages per calling app without changing auth/email logic.
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url || '');
  const context = appContext.getStore();
  if (!context?.appName || !url.includes('/api/accounts/') || !url.endsWith('/messages')) {
    return originalFetch(input, init);
  }
  try {
    const payload = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (payload?.subject && payload?.content) {
      payload.subject = String(payload.subject).replace(/^IndoVerification\b/i, context.appName);
      payload.content = buildBrandedHtml({ appName: context.appName, subject: payload.subject, plainContent: payload.content });
      payload.mailFormat = 'html';
      const nextInit = { ...init, body: JSON.stringify(payload) };
      return originalFetch(input, nextInit);
    }
  } catch (error) {
    console.error('Email template rendering failed:', error instanceof Error ? error.message : error);
  }
  return originalFetch(input, init);
};

function html(res, status, title, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h2>${title}</h2>${body}</body></html>`);
}

function configOk() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

async function zohoOAuthHandler(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/zoho/oauth/start' && req.method === 'GET') {
    if (!configOk()) return html(res, 500, 'Zoho OAuth configuration error', '<p>ZOHO_CLIENT_ID or ZOHO_CLIENT_SECRET is missing.</p>');
    const state = crypto.randomBytes(24).toString('hex');
    stateStore.set(state, Date.now() + 10 * 60 * 1000);
    const auth = new URL(`${ACCOUNTS_URL}/oauth/v2/auth`);
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('client_id', CLIENT_ID);
    auth.searchParams.set('scope', 'ZohoMail.messages.CREATE,ZohoMail.accounts.READ');
    auth.searchParams.set('redirect_uri', REDIRECT_URI);
    auth.searchParams.set('access_type', 'offline');
    auth.searchParams.set('prompt', 'consent');
    auth.searchParams.set('state', state);
    res.statusCode = 302;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', auth.toString());
    return res.end();
  }

  if (url.pathname === '/api/zoho/oauth/callback' && req.method === 'GET') {
    const error = url.searchParams.get('error');
    if (error) return html(res, 400, 'Zoho authorization failed', `<p>${error}</p>`);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state || !stateStore.has(state) || stateStore.get(state) < Date.now()) {
      stateStore.delete(state);
      return html(res, 400, 'Invalid OAuth callback', '<p>Authorization code or state is invalid/expired.</p>');
    }
    stateStore.delete(state);

    const tokenParams = new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    });
    const tokenResponse = await originalFetch(`${ACCOUNTS_URL}/oauth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenParams });
    const tokenBody = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenBody.refresh_token || !tokenBody.access_token) {
      const safeError = String(tokenBody.error || `Token exchange failed (${tokenResponse.status})`).replace(/[<>]/g, '');
      return html(res, 400, 'Zoho token exchange failed', `<p>${safeError}</p>`);
    }

    const accessToken = tokenBody.access_token;
    const accountsResponse = await originalFetch(`${MAIL_API_URL}/api/accounts`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: 'application/json' },
    });
    const accountsBody = await accountsResponse.json().catch(() => ({}));
    const account = Array.isArray(accountsBody.data) ? accountsBody.data.find((item) => item?.primaryEmailAddress === 'indogroup@zohomail.in' || item?.emailAddress?.some?.((x) => x?.mailId === 'indogroup@zohomail.in' && x?.isPrimary)) || accountsBody.data[0] : null;
    const accountId = account?.accountId;
    if (!accountsResponse.ok || !accountId) {
      const safeError = String(accountsBody?.status?.description || accountsBody?.message || `Account lookup failed (${accountsResponse.status})`).replace(/[<>]/g, '');
      return html(res, 400, 'Zoho account lookup failed', `<p>${safeError}</p>`);
    }

    const refresh = String(tokenBody.refresh_token).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const accountIdEscaped = String(accountId).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return html(res, 200, 'Zoho OAuth setup complete', `<p><strong>ZOHO_REFRESH_TOKEN</strong></p><pre>${refresh}</pre><p><strong>ZOHO_ACCOUNT_ID</strong></p><pre>${accountIdEscaped}</pre><p>Copy these into Railway Variables. Do not share them in chat.</p>`);
  }

  return null;
}

http.createServer = function patchedCreateServer(listener, ...args) {
  return originalCreateServer(async (req, res) => {
    const appName = safeAppName(req.headers['x-indo-app-name']);
    return appContext.run({ appName }, async () => {
      try {
        const handled = await zohoOAuthHandler(req, res);
        if (handled !== null) return handled;
        return listener(req, res);
      } catch (error) {
        console.error('OAuth route error:', error instanceof Error ? error.message : error);
        if (!res.headersSent) return html(res, 500, 'OAuth server error', '<p>OAuth setup failed. Check deployment logs.</p>');
        res.end();
      }
    });
  }, ...args);
};

await import('./server.js');
