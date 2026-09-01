import nodemailer from 'nodemailer';

const DISPLAY_NAME = String(process.env.ZOHO_FROM_DISPLAY_NAME || 'IndoVerification').trim() || 'IndoVerification';
const SMTP_HOST = String(process.env.SMTP_HOST || 'smtp.zoho.com').trim();
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '').trim();
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER || process.env.ZOHO_FROM || '').trim();
const TIMEOUT_MS = Math.max(2500, Number(process.env.SMTP_TIMEOUT_MS || 5000));

const configured = Boolean(SMTP_USER && SMTP_PASS && SMTP_FROM);
let installed = false;
const transports = new Map();

function getTransport(port, secure) {
  const key = `${port}:${secure}`;
  if (!transports.has(key)) {
    transports.set(key, nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    }));
  }
  return transports.get(key);
}

async function trySmtp({ to, subject, content }) {
  if (!configured) return false;
  const attempts = [
    [465, true],
    [587, false],
  ];

  for (const [port, secure] of attempts) {
    try {
      const info = await getTransport(port, secure).sendMail({
        from: { name: DISPLAY_NAME, address: SMTP_FROM },
        to: String(to || '').trim(),
        subject: String(subject || '').trim(),
        html: String(content || ''),
      });
      console.log(`MAIL SEND ACCEPTED provider=smtp from=${DISPLAY_NAME} <${SMTP_FROM}> port=${port} messageId=${info.messageId || 'unknown'}`);
      return true;
    } catch (error) {
      console.log(`SMTP port ${port} unavailable; trying next mail transport.`);
    }
  }
  return false;
}

export function installZohoDisplayNameMailBridge() {
  if (!configured || installed) return false;
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

  installed = true;
  console.log(`Sender identity bridge ready: ${DISPLAY_NAME} <${SMTP_FROM}> (SMTP primary, Zoho API fallback)`);
  return true;
}
