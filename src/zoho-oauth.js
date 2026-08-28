import http from 'node:http';
import crypto from 'node:crypto';

const originalCreateServer = http.createServer;
const pendingStates = new Map();
const PORT_BASE = String(process.env.PORT || '10000');
const CALLBACK_PATH = '/api/zoho/oauth/callback';
const START_PATH = '/api/zoho/oauth/start';
const ACCOUNTS_URL = String(process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in').replace(/\/$/, '');
const MAIL_URL = String(process.env.ZOHO_MAIL_API_URL || 'https://mail.zoho.in').replace(/\/$/, '');
const CLIENT_ID = String(process.env.ZOHO_CLIENT_ID || '').trim();
const CLIENT_SECRET = String(process.env.ZOHO_CLIENT_SECRET || '').trim();
const REDIRECT_URI = `https://indoverification-production.up.railway.app${CALLBACK_PATH}`;

function html(res, status, title, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h2>${title}</h2><pre style="white-space:pre-wrap;font:14px monospace">${String(message).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></body></html>`);
}

async function oauthCallback(res, url) {
  const error = url.searchParams.get('error');
  if (error) return html(res, 400, 'Zoho authorization failed', `${error}: ${url.searchParams.get('error_description') || ''}`);
  const state = String(url.searchParams.get('state') || '');
  const code = String(url.searchParams.get('code') || '');
  if (!state || !pendingStates.has(state)) return html(res, 400, 'Invalid OAuth state', 'Please start a new Zoho authorization request.');
  pendingStates.delete(state);
  if (!code) return html(res, 400, 'Missing authorization code', 'Zoho did not return a code.');
  if (!CLIENT_ID || !CLIENT_SECRET) return html(res, 500, 'Zoho client not configured', 'Set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in Railway.');
  const body = new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' });
  const tokenResponse = await fetch(`${ACCOUNTS_URL}/oauth/v2/token`, { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body });
  const token = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !token.refresh_token) return html(res, 502, 'Zoho token exchange failed', JSON.stringify(token, null, 2));
  const access = token.access_token;
  const accountsResponse = await fetch(`${MAIL_URL}/api/accounts`, { headers: { Authorization: `Zoho-oauthtoken ${access}` } });
  const accounts = await accountsResponse.json().catch(() => ({}));
  const first = accounts?.data?.[0] || accounts?.data?.accounts?.[0] || accounts?.accounts?.[0] || null;
  const accountId = first?.accountId || first?.account_id || first?.id || '';
  if (!accountId) return html(res, 502, 'Zoho account lookup failed', JSON.stringify(accounts, null, 2));
  return html(res, 200, 'Zoho OAuth complete', `REFRESH_TOKEN:\n${token.refresh_token}\n\nZOHO_ACCOUNT_ID:\n${accountId}\n\nDo NOT share these values. Copy them directly into Railway Variables, then remove this page from your history/logs.`);
}

http.createServer = function patchedCreateServer(requestListener, ...args) {
  const wrapped = async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT_BASE}`}`);
    try {
      if (url.pathname === START_PATH && req.method === 'GET') {
        if (!CLIENT_ID) return html(res, 500, 'Zoho client not configured', 'Set ZOHO_CLIENT_ID in Railway.');
        const state = crypto.randomBytes(24).toString('hex');
        pendingStates.set(state, Date.now() + 10 * 60 * 1000);
        const auth = new URL(`${ACCOUNTS_URL}/oauth/v2/auth`);
        auth.searchParams.set('response_type','code');
        auth.searchParams.set('client_id',CLIENT_ID);
        auth.searchParams.set('scope','ZohoMail.messages.CREATE,ZohoMail.accounts.READ');
        auth.searchParams.set('redirect_uri',REDIRECT_URI);
        auth.searchParams.set('access_type','offline');
        auth.searchParams.set('state',state);
        res.statusCode = 302;
        res.setHeader('Location', auth.toString());
        res.end();
        return;
      }
      if (url.pathname === CALLBACK_PATH && req.method === 'GET') {
        await oauthCallback(res, url);
        return;
      }
      for (const [key, expires] of pendingStates) if (Date.now() > expires) pendingStates.delete(key);
      return requestListener(req, res);
    } catch (error) {
      console.error('Zoho OAuth handler error:', error);
      return html(res, 500, 'Zoho OAuth error', error instanceof Error ? error.message : 'Unknown error');
    }
  };
  return originalCreateServer.call(http, wrapped, ...args);
};
