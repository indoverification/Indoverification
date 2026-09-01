import nodemailer from 'nodemailer';

const DISPLAY_NAME = String(process.env.ZOHO_FROM_DISPLAY_NAME || 'IndoVerification').trim() || 'IndoVerification';
const SMTP_HOST = String(process.env.SMTP_HOST || 'smtp.zoho.com').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE || (SMTP_PORT === 465 ? 'true' : 'false')).trim().toLowerCase() === 'true';
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '').trim();
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER || process.env.ZOHO_FROM || '').trim();
const SMTP_TIMEOUT_MS = Math.max(5000, Number(process.env.SMTP_TIMEOUT_MS || 10000));

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

async function trySmtp({ to, subject, content }) {
  const mail = getTransporter();
  if (!mail) return false;
  try {
    const info = await mail.sendMail({
      from: { name: DISPLAY_NAME, address: SMTP_FROM },
      to: String(to || '').trim(),
      subject: String(subject || '').trim(),
      html: String(content || ''),
    });
    console.log(`MAIL SEND ACCEPTED provider=smtp from=${DISPLAY_NAME} <${SMTP_FROM}> messageId=${info.messageId || 'unknown'}`);
    return true;
  } catch (error) {
    console.warn(`SMTP transport unavailable; using Zoho API fallback: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

export function installZohoDisplayNameMailBridge() {
  if (!configured || globalThis.__indoVerificationDisplayNameBridgeInstalled) return false;
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
        return originalFetch(input, init);
      }

      const delivered = await trySmtp({
        to: payload.toAddress,
        subject: payload.subject,
        content: payload.content,
      });
      if (delivered) {
        return new Response(JSON.stringify({ status: { code: 200, description: 'success' }, data: { provider: 'smtp' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    }

    return originalFetch(input, init);
  };

  globalThis.__indoVerificationDisplayNameBridgeInstalled = true;
  console.log(`Sender identity bridge ready: ${DISPLAY_NAME} <${SMTP_FROM}> (SMTP primary, Zoho API fallback)`);
  return true;
}
