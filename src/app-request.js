import { DEFAULT_APP_ID, getAppConfig } from './app-registry.js';

export const APP_ID_HEADER = 'x-indo-app-id';
export const LEGACY_APP_HEADER = 'x-indo-app-name';

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function originOf(urlValue) {
  const value = String(urlValue || '').trim();
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

export function resolveAppId({ body = {}, headers = {} } = {}) {
  const explicit = normalize(body.appId || body.appID || headers[APP_ID_HEADER] || headers[APP_ID_HEADER.toLowerCase()]);
  const legacy = normalize(headers[LEGACY_APP_HEADER] || headers[LEGACY_APP_HEADER.toLowerCase()]);
  const candidate = explicit || legacy || DEFAULT_APP_ID;
  return getAppConfig(candidate).id;
}

export function resolveAppContext(options = {}) {
  const appId = resolveAppId(options);
  const app = getAppConfig(appId);
  const requestOrigin = normalize(options.origin || options.headers?.origin || options.headers?.Origin);
  const allowedOrigin = originOf(app.url);

  if (requestOrigin && allowedOrigin && requestOrigin !== allowedOrigin) {
    const error = new Error('Application origin is not allowed.');
    error.code = 'APP_ORIGIN_NOT_ALLOWED';
    throw error;
  }

  return Object.freeze({
    appId: app.id,
    app,
    origin: requestOrigin || allowedOrigin,
  });
}
