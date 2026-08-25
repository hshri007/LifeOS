/**
 * Central configuration. Secrets are read from environment only
 * (spec §7.3: secrets never hardcoded; dedicated secrets manager in production).
 */
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..', '..');

export const config = {
  port: Number(process.env.PORT || 4000),
  dataDir: process.env.LIFEOS_DATA_DIR || path.join(ROOT, 'data'),
  dbPath: process.env.LIFEOS_DB_PATH || path.join(ROOT, 'data', 'lifeos.db'),
  /** Comma-separated allow-list for the email forwarding ingestion path (§4.2). Empty = allow all (dev only). */
  emailAllowlist: (process.env.LIFEOS_EMAIL_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  sessionTtlDays: 30,
  /** Max upload size in bytes (spec §2.4 step 2: size limits). */
  maxUploadBytes: 10 * 1024 * 1024,
  corsOrigin: process.env.LIFEOS_CORS_ORIGIN || '*',
  env: process.env.NODE_ENV || 'development',
};

export const isProd = config.env === 'production';