// Railway runtime entrypoint.
// Normalize every outgoing Indomark email at the final delivery boundary so
// legacy/cached renderers cannot reintroduce the old logo, emoji, or links.
const originalFetch = globalThis.fetch.bind(globalThis);

const BRAND_LOGO = '<span style="font-size:24px;line-height:1;color:#58e7a5;font-weight:900;vertical-align:middle">&#9889;&#65038;</span><span style="font-size:24px;line-height:1;font-weight:800;color:#f7fbff;vertical-align:middle;margin-left:6px">Indo</span><span style="font-size:24px;line-height:1;font-weight:800;color:#58e7a5;vertical-align:middle">mark</span>';

function normalizeEmailHtml(html) {
  let value = String(html || '');

  // Remove emoji presentations that do not match the Indomark UI.
  value = value.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, (match) => match === '\u26a1' ? '' : '');

  // Never send clickable links or visible external URLs in security emails.
  value = value.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
  value = value.replace(/https?:\/\/[^\s"'<>]+/gi, '');
  value = value.replace(/mailto:[^\s"'<>]+/gi, '');

  // Replace the current email header when present.
  value = value.replace(
    /<tr><td[^>]*align="center"[^>]*background:#050914[^>]*>[\s\S]*?<\/td><\/tr>/i,
    `<tr><td align="center" style="padding:24px 20px 20px;background:#050914;border-bottom:1px solid #1b2a41">${BRAND_LOGO}</td></tr>`,
  );

  // Replace common legacy div-style headers as well.
  value = value.replace(
    /<div[^>]*background:\s*#0b1020[^>]*>[\s\S]*?<\/div>/i,
    `<div style="background:#050914;padding:24px 20px;text-align:center">${BRAND_LOGO}</div>`,
  );

  // Remove legacy footer URL/link rows and rebuild a plain-text footer.
  value = value.replace(
    /<tr><td[^>]*background:#07101d[^>]*>[\s\S]*?<\/td><\/tr>/i,
    '<tr><td align="center" style="padding:18px 20px;background:#07101d;border-top:1px solid #1b2a41;color:#7f8da1;font-size:12px;line-height:1.7">Automated email from <strong style="color:#cbd5e1">Indomark</strong>.<br><span style="color:#6f7f92">This message was sent by the Indomark security system.</span></td></tr>',
  );

  // Remove celebration/security emojis left inside old subject/body templates.
  value = value.replace(/[🎉🥳🔐🔒🔑✅⚡]/gu, '');

  return value;
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url || '');
  if (url.includes('/api/accounts/') && url.endsWith('/messages') && typeof init.body === 'string') {
    try {
      const payload = JSON.parse(init.body);
      if (payload && typeof payload.content === 'string') {
        payload.content = normalizeEmailHtml(payload.content);
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
