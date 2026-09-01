import nodemailer from 'nodemailer';

const SMTP_HOST = String(process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true' || SMTP_PORT === 465;
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || '').trim();
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER).trim();
const DISPLAY_NAME = String(process.env.ZOHO_FROM_DISPLAY_NAME || 'IndoVerification').trim() || 'IndoVerification';

const enabled = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM);
let transporter = null;

function getTransporter() {
  if (!enabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }
  return transporter;
}

export function installSmtpMailBridge() {
  if (!enabled) {
    console.warn('SMTP mail bridge disabled: SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM are not fully configured.');
    return false;
  }

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== 'function' || globalThis.__indoVerificationSmtpBridgeInstalled) return Boolean(globalThis.__indoVerificationSmtpBridgeInstalled);

  globalThis.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input?.url || '';
    const url = String(rawUrl);
    const method = String(init?.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();

    if (method === 'POST' && /\/api\/accounts\/[^/]+\/messages(?:\?|$)/.test(url)) {
      let payload = {};
      try {
        payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      } catch (error) {
        return new Response(JSON.stringify({ status: { code: 400, description: `Invalid mail payload: ${error instanceof Error ? error.message : error}` } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      try {
        const mail = getTransporter();
        if (!mail) return originalFetch(input, init);
        const info = await mail.sendMail({
          from: { name: DISPLAY_NAME, address: SMTP_FROM },
          to: String(payload.toAddress || '').trim(),
          subject: String(payload.subject || '').trim(),
          html: String(payload.content || ''),
        });
        console.log(`MAIL SEND ACCEPTED provider=smtp messageId=${info.messageId || 'unknown'}`);
        return new Response(JSON.stringify({ status: { code: 200, description: 'success' }, data: { messageId: info.messageId || null } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`MAIL SEND FAILED provider=smtp: ${message}`);
        return new Response(JSON.stringify({ status: { code: 550, description: message } }), {
          status: 550,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return originalFetch(input, init);
  };

  globalThis.__indoVerificationSmtpBridgeInstalled = true;
  console.log(`SMTP mail bridge enabled: ${DISPLAY_NAME} <${SMTP_FROM}>`);
  return true;
}
