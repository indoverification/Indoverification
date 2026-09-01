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
  const id = String(appId || '').trim().toLowerCase();
  const app = APPsafe(id);
  if (!app) {
    const error = new Error('Unknown application.');
    error.code = 'UNKNOWN_APP';
    throw error;
  }
  return app;
}

export function hasApp(appId) {
  const id = String(appId || '').trim().toLowerCase();
  return Boolean(APPs[id]);
}

export function listApps() {
  return Object.values(APPs).map(({ id, name, url, supportEmail, templateRoot }) => ({
    id, name, url, supportEmail, templateRoot,
  }));
}

function APPsafe(id) {
  return Object.prototype.hasOwnProperty.call(APPs, id) ? APPs[id] : null;
}

export const DEFAULT_APP_ID = 'indomark';
