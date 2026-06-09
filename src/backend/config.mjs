import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_FILE = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(CURRENT_FILE), '../..');

export const paths = {
  root: ROOT_DIR,
  publicDir: path.join(ROOT_DIR, 'public'),
  dataDir: path.join(ROOT_DIR, 'data'),
  cacheFile: path.join(ROOT_DIR, 'data', 'dashboard-cache.json'),
  databaseFile: path.join(ROOT_DIR, 'data', 'app.sqlite'),
  personnelDatabaseFile: path.join(ROOT_DIR, 'data', 'personnel-database.json'),
  envFile: path.join(ROOT_DIR, '.env'),
};

export function loadEnvFile(filePath = paths.envFile) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function readJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`);
  }
}

function readNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

function readBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function readPathEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return path.resolve(ROOT_DIR, raw);
}

export function getConfig() {
  loadEnvFile();

  return {
    port: readNumberEnv('PORT', 4200),
    host: process.env.HOST || '',
    mode: (process.env.DINGTALK_MODE || 'mock').toLowerCase(),
    dashboardSyncEnabled: readBooleanEnv('DASHBOARD_SYNC_ENABLED', false),
    dashboardAutoUpdateEnabled: readBooleanEnv('DASHBOARD_AUTO_UPDATE_ENABLED', true),
    devReloadEnabled: readBooleanEnv('DASHBOARD_DEV_RELOAD', true),
    syncApiKey: process.env.SYNC_API_KEY || '',
    syncMinIntervalMs: readNumberEnv('SYNC_MIN_INTERVAL_MS', 60_000),
    maxJsonBodyBytes: readNumberEnv('MAX_JSON_BODY_BYTES', 256 * 1024),
    publicDir: readPathEnv('PUBLIC_DIR', paths.publicDir),
    cacheFile: process.env.LOCAL_CACHE_FILE || paths.cacheFile,
    databaseFile: process.env.LOCAL_DATABASE_FILE || paths.databaseFile,
    personnelDatabaseFile:
      process.env.PERSONNEL_DATABASE_FILE || process.env.PERSONNEL_ARCHITECTURE_FILE || paths.personnelDatabaseFile,
    dingtalk: {
      appKey: process.env.DINGTALK_APP_KEY || '',
      appSecret: process.env.DINGTALK_APP_SECRET || '',
      tokenUrl: process.env.DINGTALK_TOKEN_URL || '',
      tokenMethod: (process.env.DINGTALK_TOKEN_METHOD || 'POST').toUpperCase(),
      tokenAuthMode: (process.env.DINGTALK_TOKEN_AUTH_MODE || 'appSecret').toLowerCase(),
      recordsListUrl: process.env.DINGTALK_RECORDS_LIST_URL || '',
      recordsMethod: (process.env.DINGTALK_RECORDS_METHOD || 'POST').toUpperCase(),
      accessTokenHeader: process.env.DINGTALK_ACCESS_TOKEN_HEADER || 'authorization',
      recordsRequestBody: readJsonEnv('DINGTALK_RECORDS_LIST_BODY_JSON', {}),
      pageSize: readNumberEnv('DINGTALK_PAGE_SIZE', 100),
      fieldMap: readJsonEnv('DINGTALK_FIELD_MAP_JSON', {}),
      maxPages: readNumberEnv('DINGTALK_MAX_PAGES', 200),
    },
  };
}
