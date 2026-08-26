/**
 * Authentication & sessions (FR-001, FR-002-ready).
 *
 * Bearer-token sessions; tokens stored hashed (a DB leak does not leak sessions).
 * scrypt password hashing. MFA/passkey hooks are stubbed at the schema level
 * (users.mfa_enabled) for Phase 7 hardening.
 */
import type { NextFunction, Request, Response } from 'express';
import { db } from './db';
import { config, isProd } from './config';
import { hashPassword, nowISO, randomToken, sha256, uuid, verifyPassword, rateLimit } from './util';
import { audit } from './engine/tools';
import { sendVerificationEmail } from './mailer';

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

export async function handleRegister(req: AuthedRequest, res: Response): Promise<void> {
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
  const otp = await issueOtp(id, normalizedEmail, ip);
  res.status(201).json({ token, user: publicUser(id), needsVerification: true, devCode: otp.devCode });
}

export async function handleLogin(req: AuthedRequest, res: Response): Promise<void> {
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
  const verified = db.prepare('SELECT email_verified FROM users WHERE id = ?').get(row.id) as { email_verified: number };
  if (!verified.email_verified) {
    const otp = await issueOtp(row.id, email, ip);
    res.json({ token, user: publicUser(row.id), needsVerification: true, devCode: otp.devCode });
    return;
  }
  res.json({ token, user: publicUser(row.id) });
}

export function handleLogout(req: AuthedRequest, res: Response): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  destroySession(token);
  if (req.userId) audit(req.userId, 'auth.logout', 'user', req.userId, {});
  res.json({ ok: true });
}

/** Issue a 6-digit OTP: stores hash, emails it, returns devCode when SMTP is unavailable in dev. */
async function issueOtp(userId: string, email: string, ip?: string): Promise<{ sent: boolean; devCode?: string }> {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(userId);
  db.prepare('INSERT INTO email_verifications (id, user_id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uuid(), userId, sha256(code), new Date(Date.now() + 10 * 60_000).toISOString(), nowISO());
  const sent = await sendVerificationEmail(email, code);
  audit(userId, 'auth.otp_issued', 'user', userId, { channel: sent ? 'email' : 'dev' }, ip);
  // Dev convenience only: with SMTP configured the code is NEVER in the API response.
  return sent ? { sent } : { sent: false, devCode: isProd ? undefined : code };
}

/** Verify a submitted OTP with expiry + attempt limits (max 5). */
export async function handleVerifyOtp(req: AuthedRequest, res: Response): Promise<void> {
  if (!req.userId) { res.status(401).json({ error: 'Authentication required.' }); return; }
  const code = String(req.body?.code ?? '').replace(/\D/g, '');
  if (code.length !== 6) { res.status(400).json({ error: 'Enter the 6-digit code.' }); return; }
  const row = db.prepare('SELECT * FROM email_verifications WHERE user_id = ?').get(req.userId) as
    | { id: string; code_hash: string; expires_at: string; attempts: number } | undefined;
  if (!row) { res.status(400).json({ error: 'No code pending — request a new one.' }); return; }
  if (new Date(row.expires_at) < new Date()) { res.status(400).json({ error: 'Code expired — request a new one.' }); return; }
  if (row.attempts >= 5) { res.status(429).json({ error: 'Too many attempts — request a new code.' }); return; }
  if (sha256(code) !== row.code_hash) {
    db.prepare('UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    res.status(400).json({ error: 'Incorrect code.' });
    return;
  }
  db.prepare('DELETE FROM email_verifications WHERE id = ?').run(row.id);
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(req.userId);
  audit(req.userId, 'auth.email_verified', 'user', req.userId, {}, req.ip);
  res.json({ ok: true, user: publicUser(req.userId) });
}

export async function handleResendOtp(req: AuthedRequest, res: Response): Promise<void> {
  if (!req.userId) { res.status(401).json({ error: 'Authentication required.' }); return; }
  if (!rateLimit(`otp:${req.userId}`, 3, 60_000)) {
    res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
    return;
  }
  const u = db.prepare('SELECT email FROM users WHERE id = ?').get(req.userId) as { email: string };
  const r = await issueOtp(req.userId, u.email, req.ip);
  res.json({ ok: true, sent: r.sent, devCode: r.devCode });
}


export function publicUser(userId: string): Record<string, unknown> {
  const r = db.prepare('SELECT id, email, locale, timezone, status, mfa_enabled, email_verified, created_at FROM users WHERE id = ?')
    .get(userId) as Record<string, unknown> | undefined;
  return r ?? {};
}

/**
 * GET /auth/me — lets the client validate a stored token on load and fetch
 * the signed-in user's profile without decoding anything client-side.
 */
export function handleMe(req: AuthedRequest, res: Response): void {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  res.json({ user: publicUser(req.userId) });
}

/**
 * POST /auth/demo — one-click demo experience (§9.4 launch funnel: get the
 * user to first value fast). Creates (or reuses) a personal demo account with
 * seeded sample documents and returns a session token.
 */
export function handleDemoLogin(req: AuthedRequest, res: Response): void {
  const ip = req.ip;
  if (!rateLimit(`demo:${ip}`, 10, 60_000)) {
    res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
    return;
  }
  // Each demo login gets its own throwaway account so multiple visitors can
  // explore independently; the email is deterministic per browser session
  // passed by the client when available.
  const sessionId = String(req.body?.session ?? '').slice(0, 40);
  const email = sessionId
    ? `demo+${sessionId.replace(/[^a-z0-9-]/gi, '')}@lifeos.app`
    : `demo+${Date.now().toString(36)}@lifeos.app`;

  let row = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
  if (!row) {
    const id = uuid();
    db.prepare('INSERT INTO users (id, email, password_hash, locale, timezone, status, mfa_enabled, email_verified, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)')
      .run(id, email, hashPassword(randomToken()), 'en-IN', 'Asia/Kolkata', 'active', nowISO());
    db.prepare('INSERT INTO profiles (user_id, display_name, preferences) VALUES (?, ?, ?)')
      .run(id, 'Demo User', '{}');
    row = { id };
    audit(id, 'auth.demo_created', 'user', id, {}, ip);
  }
  const { token } = createSession(row.id);
  audit(row.id, 'auth.demo_login', 'user', row.id, {}, ip);
  res.json({ token, user: publicUser(row.id) });
}
