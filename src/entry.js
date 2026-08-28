import http from 'node:http';
import crypto from 'node:crypto';
import 'dotenv/config';

const originalCreateServer = http.createServer.bind(http);
const stateStore = new Map();
const ACCOUNTS_URL = String(process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in').replace(/\/$/, '');
const MAIL_API_URL = String(process.env.ZOHO_MAIL_API_URL || 'https://mail.zoho.in').replace(/\/$/, '');
const CLIENT_ID = String(process.env.ZOHO_CLIENT_ID || '').trim();
const CLIENT_SECRET = String(process.env.ZOHO_CLIENT_SECRET || '').trim();
const REDIRECT_URI = String(process.env.ZOHO_REDIRECT_URI || 'https://indoverification-production.up.railway.app/api/zoho/oauth/callback').trim();

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
    const tokenResponse = await fetch(`${ACCOUNTS_URL}/oauth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenParams });
    const tokenBody = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenBody.refresh_token || !tokenBody.access_token) {
      const safeError = String(tokenBody.error || `Token exchange failed (${tokenResponse.status})`).replace(/[<>]/g, '');
      return html(res, 400, 'Zoho token exchange failed', `<p>${safeError}</p>`);
    }

    const accessToken = tokenBody.access_token;
    const accountsResponse = await fetch(`${MAIL_API_URL}/api/accounts`, {
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
    try {
      const handled = await zohoOAuthHandler(req, res);
      if (handled !== null) return handled;
      return listener(req, res);
    } catch (error) {
      console.error('OAuth route error:', error instanceof Error ? error.message : error);
      if (!res.headersSent) return html(res, 500, 'OAuth server error', '<p>OAuth setup failed. Check deployment logs.</p>');
      res.end();
    }
  }, ...args);
};

await import('./server.js');
