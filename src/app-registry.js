const APPS = Object.freeze({
  indomark: Object.freeze({
    id: 'indomark',
    name: 'Indomark',
    url: 'https://indomark.github.io/Indomark/',
    supportEmail: 'indomark@zohomail.in',
    templateRoot: 'indomark',
  }),
  indoone: Object.freeze({
    id: 'indoone',
    name: 'Indoone',
    url: 'https://indooneteam.github.io/indoone/',
    supportEmail: 'indomark@zohomail.in',
    templateRoot: 'indoone',
  }),
});

export function getAppConfig(appId = 'indomark') {
  const id = normalizeAppId(appId);
  const app = APPS[id];
  if (!app) {
    const error = new Error('Unknown application.');
    error.code = 'UNKNOWN_APP';
    throw error;
  }
  return app;
}

export function hasApp(appId) {
  const id = normalizeAppId(appId);
  return Object.prototype.hasOwnProperty.call(APPS, id);
}

export function listApps() {
  return Object.values(APPS).map(({ id, name, url, supportEmail, templateRoot }) => ({
    id, name, url, supportEmail, templateRoot,
  }));
}

function normalizeAppId(appId) {
  return String(appId || '').trim().toLowerCase();
}

export const DEFAULT_APP_ID = 'indomark';
