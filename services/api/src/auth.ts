/**
 * Authentication & sessions (FR-001, FR-002-ready).
 *
 * Bearer-token sessions; tokens stored hashed (a DB leak does not leak sessions).
 * scrypt password hashing. MFA/passkey hooks are stubbed at the schema level
 * (users.mfa_enabled) for Phase 7 hardening.
 */
import type { NextFunction, Request, Response } from 'express';
import { db } from './db';
import { config } from './config';
import { hashPassword, nowISO, randomToken, sha256, uuid, verifyPassword, rateLimit } from './util';
import { audit } from './engine/tools';

export interface AuthedRequest extends Request {
  userId?: string;
}

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uuid(), userId, sha256(token), expiresAt, nowISO());
  return { token, expiresAt };
}

export function destroySession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const row = db.prepare(
    `SELECT s.user_id, s.expires_at, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
  ).get(sha256(token)) as { user_id: string; expires_at: string; status: string } | undefined;

  if (!row || new Date(row.expires_at) < new Date() || row.status !== 'active') {
    res.status(401).json({ error: 'Session invalid or expired.' });
    return;
  }
  req.userId = row.user_id;
  next();
}

/* --------------------------- handlers --------------------------- */

export function handleRegister(req: AuthedRequest, res: Response): void {
  const ip = req.ip;
  if (!rateLimit(`register:${ip}`, 10, 60_000)) {
    res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
    return;
  }
  const { email, password, timezone, locale } = req.body as {
    email?: string; password?: string; timezone?: string; locale?: string;
  };
  if (!email || !password || password.length < 8) {
    res.status(400).json({ error: 'Email and a password of at least 8 characters are required.' });
    return;
  }
  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const id = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, locale, timezone, status, mfa_enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
    .run(id, normalizedEmail, hashPassword(password), locale ?? 'en-IN', timezone ?? 'Asia/Kolkata', 'active', nowISO());
  db.prepare('INSERT INTO profiles (user_id, display_name, preferences) VALUES (?, ?, ?)')
    .run(id, normalizedEmail.split('@')[0], '{}');

  const { token } = createSession(id);
  audit(id, 'auth.registered', 'user', id, {}, ip);
  res.status(201).json({ token, user: publicUser(id) });
}

export function handleLogin(req: AuthedRequest, res: Response): void {
  const ip = req.ip;
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!rateLimit(`login:${ip}:${email}`, 15, 60_000)) {
    res.status(429).json({ error: 'Too many login attempts. Try again shortly.' });
    return;
  }
  const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) as
    | { id: string; password_hash: string }
    | undefined;
  if (!row || !verifyPassword(String(req.body?.password ?? ''), row.password_hash)) {
    audit(row?.id ?? 'anonymous', 'auth.login_failed', 'user', row?.id, {}, ip);
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  const { token } = createSession(row.id);
  audit(row.id, 'auth.login', 'user', row.id, {}, ip);
  res.json({ token, user: publicUser(row.id) });
}

export function handleLogout(req: AuthedRequest, res: Response): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  destroySession(token);
  if (req.userId) audit(req.userId, 'auth.logout', 'user', req.userId, {});
  res.json({ ok: true });
}

export function publicUser(userId: string): Record<string, unknown> {
  const r = db.prepare('SELECT id, email, locale, timezone, status, mfa_enabled, created_at FROM users WHERE id = ?')
    .get(userId) as Record<string, unknown> | undefined;
  return r ?? {};
}