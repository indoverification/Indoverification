import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APPS_ROOT = path.join(ROOT, 'apps');
export const DEFAULT_APP_ID = 'indomark';

function normalizeAppId(value) {
  return String(value || '').trim().toLowerCase();
}

function validAppId(value) {
  return /^[a-z0-9][a-z0-9_-]{1,63}$/.test(value);
}

function originOf(urlValue) {
  const value = String(urlValue || '').trim();
  if (!value) return '';
  try { return new URL(value).origin; } catch { return ''; }
}

function loadAppManifests() {
  const registry = Object.create(null);
  const origins = new Map();
  if (!fs.existsSync(APPS_ROOT)) return registry;

  for (const entry of fs.readdirSync(APPS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const appId = normalizeAppId(entry.name);
    if (!validAppId(appId)) continue;

    const manifestPath = path.join(APPS_ROOT, entry.name, 'app.json');
    if (!fs.existsSync(manifestPath)) continue;

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      console.error(`Invalid app manifest: ${manifestPath}`, error);
      continue;
    }

    if (normalizeAppId(manifest.id) !== appId || manifest.enabled === false) continue;

    const url = String(manifest.url || '').trim();
    const origin = originOf(url);
    if (origin) {
      const previous = origins.get(origin);
      if (previous) {
        console.error(`Duplicate app origin rejected: ${origin} (${previous} and ${appId})`);
        continue;
      }
      origins.set(origin, appId);
    }

    registry[appId] = Object.freeze({
      id: appId,
      name: String(manifest.name || appId).trim(),
      url,
      supportEmail: String(manifest.supportEmail || '').trim().toLowerCase(),
      templateRoot: String(manifest.templateRoot || appId).trim(),
      rootPath: path.join(APPS_ROOT, entry.name),
    });
  }

  return registry;
}

const APPS = Object.freeze(loadAppManifests());

export function getAppConfig(appId = DEFAULT_APP_ID) {
  const id = normalizeAppId(appId || DEFAULT_APP_ID);
  const app = APPS[id];
  if (!app) {
    const error = new Error('Unknown application.');
    error.code = 'UNKNOWN_APP';
    throw error;
  }
  return app;
}

export function hasApp(appId) {
  return Boolean(APPS[normalizeAppId(appId)]);
}

export function listApps() {
  return Object.values(APPS).map(({ id, name, url, supportEmail, templateRoot }) => ({
    id, name, url, supportEmail, templateRoot,
  }));
}

export function appRoot(appId) {
  return getAppConfig(appId).rootPath;
}
