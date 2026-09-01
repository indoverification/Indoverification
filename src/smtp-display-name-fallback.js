import nodemailer from 'nodemailer';

// This transport is intentionally the ONLY delivery path when the bridge is installed.
// The sender identity is fixed globally and is never derived from an app template.
const DISPLAY_NAME = String(process.env.ZOHO_FROM_DISPLAY_NAME || 'IndoVerification').trim() || 'IndoVerification';
const RAW_HOST = String(process.env.SMTP_HOST || 'smtp.zoho.in').trim();
// Zoho's India accounts use smtp.zoho.in. Normalize the old .com value so a stale
// Railway variable cannot send this service to the wrong regional SMTP endpoint.
const SMTP_HOST = /^smtp\.zoho\.com$/i.test(RAW_HOST) ? 'smtp.zoho.in' : RAW_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE || (SMTP_PORT === 465 ? 'true' : 'false')).trim().toLowerCase() === 'true';
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '').trim();
const SMTP_FROM = String(process.env.SMTP_FROM || process.env.ZOHO_FROM || SMTP_USER || '').trim();
const SMTP_TIMEOUT_MS = Math.max(5000, Number(process.env.SMTP_TIMEOUT_MS || 15000));

const configured = Boolean(SMTP_USER && SMTP_PASS && SMTP_FROM);
let transporter;

function getTransporter() {
  if (!configured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });
  }
  return transporter;
}

function normalizeSingleRecipient(value) {
  const recipient = String(value || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(recipient)) throw new Error('The recipient email address is invalid.');
  return recipient;
}

async function sendSmtp({ to, subject, content }) {
  const mail = getTransporter();
  if (!mail) throw new Error('SMTP sender is not configured. Set SMTP_USER, SMTP_PASS and SMTP_FROM.');
  const recipient = normalizeSingleRecipient(to);
  const info = await mail.sendMail({
    from: { name: DISPLAY_NAME, address: SMTP_FROM },
    to: recipient,
    cc: undefined,
    bcc: undefined,
    replyTo: undefined,
    subject: String(subject || '').trim(),
    html: String(content || ''),
  });
  console.log(`MAIL SEND ACCEPTED provider=smtp host=${SMTP_HOST} from=${DISPLAY_NAME} <${SMTP_FROM}> to=${recipient} messageId=${info.messageId || 'unknown'}`);
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
  console.log(`Sender identity bridge ready: ${DISPLAY_NAME} <${SMTP_FROM}> via ${SMTP_HOST}:${SMTP_PORT} (SMTP-only)`);
  return true;
}
