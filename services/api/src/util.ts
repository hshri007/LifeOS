/**
 * Shared utilities: ids, hashing, password crypto, time & formatting helpers.
 * Password hashing uses scrypt from node:crypto (no native deps) per §7.3.
 */
import crypto from 'node:crypto';

export const uuid = (): string => crypto.randomUUID();

export const nowISO = (): string => new Date().toISOString();

export const sha256 = (input: string | Buffer): string =>
  crypto.createHash('sha256').update(input).digest('hex');

/* ------------------------- passwords ------------------------- */

const SCRYPT_N = 16384;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64, { N: SCRYPT_N }).toString('hex');
  return `scrypt$${SCRYPT_N}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, nStr, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const derived = crypto.scryptSync(password, salt, 64, { N: Number(nStr) });
    const expected = Buffer.from(hash, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export const randomToken = (): string => crypto.randomBytes(32).toString('hex');

/* --------------------------- time ---------------------------- */

export const addDays = (iso: ISODateLike, days: number): Date => {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

export const addMonths = (iso: ISODateLike, months: number): Date => {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // Clamp to end of month when original day does not exist (e.g., Jan 31 + 1m).
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
};

type ISODateLike = string | number | Date;

/** Midnight UTC of the given date. */
export const startOfUTCDay = (d: ISODateLike): Date => {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
};

export const daysBetween = (a: ISODateLike, b: ISODateLike): number =>
  Math.round((startOfUTCDay(b).getTime() - startOfUTCDay(a).getTime()) / 86_400_000);

/* ------------------------ formatting -------------------------- */

export function formatMoney(amount: number, currency = 'INR'): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatDueLabel(iso: string, now = new Date()): string {
  const diff = daysBetween(now, iso);
  if (diff === 0) return 'due today';
  if (diff === 1) return 'due tomorrow';
  if (diff > 1) return `due in ${diff} days`;
  if (diff === -1) return '1 day overdue';
  return `${-diff} days overdue`;
}

/* ---------------------- simple rate limiter ------------------- */

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Fixed-window in-memory rate limiter (spec §8.5). Suitable for MVP single-node. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}