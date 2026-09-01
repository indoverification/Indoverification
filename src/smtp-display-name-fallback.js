import nodemailer from 'nodemailer';

// One global sender identity for every app. App-specific branding stays in the
// template layer and is never allowed to change this From identity.
const DISPLAY_NAME = String(process.env.ZOHO_FROM_DISPLAY_NAME || 'IndoVerification').trim() || 'IndoVerification';
const RAW_HOST = String(process.env.SMTP_HOST || 'smtp.zoho.com').trim();
// Zoho's documented SMTP host is smtp.zoho.com. Normalize a stale regional
// value back to the supported host instead of sending requests to an endpoint
// that can time out in the hosted runtime.
const SMTP_HOST = /^smtp\.zoho\.in$/i.test(RAW_HOST) ? 'smtp.zoho.com' : RAW_HOST;
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '').trim();
const RAW_FROM = String(process.env.SMTP_FROM || process.env.ZOHO_FROM || SMTP_USER || '').trim();
const SMTP_FROM = (RAW_FROM.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/)?.[1] || RAW_FROM).trim().toLowerCase();
const SMTP_TIMEOUT_MS = Math.max(5000, Number(process.env.SMTP_TIMEOUT_MS || 12000));

const configured = Boolean(SMTP_USER && SMTP_PASS && SMTP_FROM);
const transporters = new Map();

function getTransporter(port) {
  if (!configured) return null;
  if (!transporters.has(port)) {
    const secure = port === 465;
    transporters.set(port, nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    }));
  }
  return transporters.get(port);
}

function normalizeSingleRecipient(value) {
  const recipient = String(value || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(recipient)) throw new Error('The recipient email address is invalid.');
  return recipient;
}

async function sendSmtp({ to, subject, content }) {
  if (!configured) throw new Error('SMTP sender is not configured. Set SMTP_USER, SMTP_PASS and SMTP_FROM.');
  const recipient = normalizeSingleRecipient(to);
  let lastError = null;

  // Same Zoho SMTP provider only. Try the two documented outgoing ports; do
  // not switch to another provider or another delivery API.
  for (const port of [465, 587]) {
    try {
      const mail = getTransporter(port);
      const info = await mail.sendMail({
        from: { name: DISPLAY_NAME, address: SMTP_FROM },
        to: recipient,
        cc: undefined,
        bcc: undefined,
        replyTo: undefined,
        subject: String(subject || '').trim(),
        html: String(content || ''),
      });
      console.log(`MAIL SEND ACCEPTED provider=smtp host=${SMTP_HOST} port=${port} from=${DISPLAY_NAME} <${SMTP_FROM}> to=${recipient} messageId=${info.messageId || 'unknown'}`);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`Zoho SMTP ${SMTP_HOST}:${port} unavailable: ${error instanceof Error ? error.message : error}`);
    }
  }

  throw new Error(`Zoho SMTP delivery failed on ports 465 and 587: ${lastError instanceof Error ? lastError.message : String(lastError || 'connection failed')}`);
}

export function installZohoDisplayNameMailBridge() {
  if (globalThis.__indoVerificationDisplayNameBridgeInstalled) return true;
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== 'function') return false;

  globalThis.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input?.url || '';
    const url = String(rawUrl);
    const method = String(init?.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();

    if (method === 'POST' && /\/api\/accounts\/[^/]+\/messages(?:\?|$)/.test(url)) {
      let payload = {};
      try {
        payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      } catch {
        return new Response(JSON.stringify({ status: { code: 400, description: 'Invalid mail payload.' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      try {
        await sendSmtp({ to: payload.toAddress, subject: payload.subject, content: payload.content });
        return new Response(JSON.stringify({ status: { code: 200, description: 'success' }, data: { provider: 'smtp' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`MAIL SEND FAILED provider=smtp host=${SMTP_HOST}: ${message}`);
        return new Response(JSON.stringify({ status: { code: 550, description: `SMTP delivery failed: ${message}` } }), {
          status: 550,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return originalFetch(input, init);
  };

  globalThis.__indoVerificationDisplayNameBridgeInstalled = true;
  console.log(`Sender identity bridge ready: ${DISPLAY_NAME} <${SMTP_FROM}> via ${SMTP_HOST} (SMTP-only; ports 465/587)`);
  return true;
}
