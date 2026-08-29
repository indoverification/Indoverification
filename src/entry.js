// Railway runtime entrypoint.
// Normalize outgoing emails at the final delivery boundary without changing
// the intended Indomark welcome experience.
const originalFetch = globalThis.fetch.bind(globalThis);

const BRAND_LOGO = '<span style="font-size:24px;line-height:1;color:#58e7a5;font-weight:900;vertical-align:middle">&#9889;&#65038;</span><span style="font-size:24px;line-height:1;font-weight:800;color:#f7fbff;vertical-align:middle;margin-left:6px">Indo</span><span style="font-size:24px;line-height:1;font-weight:800;color:#58e7a5;vertical-align:middle">mark</span>';

function normalizeEmailHtml(html, subject) {
  let value = String(html || '');
  const isWelcome = /^Indomark\s*•\s*Welcome(?: back)?/i.test(String(subject || ''));

  // Keep emojis in all emails. The user-facing welcome messages intentionally use them.

  // OTP/security emails must remain link-free. Welcome emails intentionally retain
  // their direct app button so users can open Indomark from the message.
  if (!isWelcome) {
    value = value.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
    value = value.replace(/https?:\/\/[^\s"'<>]+/gi, '');
    value = value.replace(/mailto:[^\s"'<>]+/gi, '');
  }

  // Use the Indomark wordmark consistently across every outgoing email.
  value = value.replace(
    /<tr><td[^>]*align="center"[^>]*background:#050914[^>]*>[\s\S]*?<\/td><\/tr>/i,
    `<tr><td align="center" style="padding:24px 20px 20px;background:#050914;border-bottom:1px solid #1b2a41">${BRAND_LOGO}</td></tr>`,
  );

  value = value.replace(
    /<div[^>]*background:\s*#0b1020[^>]*>[\s\S]*?<\/div>/i,
    `<div style="background:#050914;padding:24px 20px;text-align:center">${BRAND_LOGO}</div>`,
  );

  // Never expose the raw app URL as footer text. Welcome buttons are preserved.
  value = value.replace(/<span[^>]*>indomark\.github\.io\/Indomark\/?<\/span>/gi, '<span style="color:#6f7f92">This message was sent by the Indomark security system.</span>');
  value = value.replace(/<span[^>]*>https?:\/\/indomark\.github\.io\/Indomark\/?<\/span>/gi, '<span style="color:#6f7f92">This message was sent by the Indomark security system.</span>');

  return value;
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url || '');
  if (url.includes('/api/accounts/') && url.endsWith('/messages') && typeof init.body === 'string') {
    try {
      const payload = JSON.parse(init.body);
      if (payload && typeof payload.content === 'string') {
        payload.content = normalizeEmailHtml(payload.content, payload.subject);
        payload.mailFormat = 'html';
        return originalFetch(input, { ...init, body: JSON.stringify(payload) });
      }
    } catch (error) {
      console.error('Indomark email normalization failed:', error instanceof Error ? error.message : error);
    }
  }
  return originalFetch(input, init);
};

await import('./server.js');
