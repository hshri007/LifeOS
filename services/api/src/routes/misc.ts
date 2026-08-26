/**
 * Platform routes: dashboard (§3.3), notifications, reminder worker tick,
 * consent center (§4.6), email ingestion (§4.2), audit log (FR-013),
 * data export/delete (FR-014/015).
 */
import { Router } from 'express';
import { IngestEmailSchema } from '@lifeos/types';
import { requireAuth, type AuthedRequest } from '../auth';
import { db } from '../db';
import { config } from '../config';
import { buildDashboard } from '../engine/briefing';
import { listNotifications, markNotificationsRead, runReminderTick } from '../engine/reminders';
import { createRecordsFromManual } from '../engine/manual';
import { ingestText } from '../extraction/pipeline';
import { audit } from '../engine/tools';
import { nowISO, sha256, uuid } from '../util';

export const miscRouter = Router();
miscRouter.use(requireAuth);

/* ----------------------------- dashboard ----------------------------- */

miscRouter.get('/dashboard', (req: AuthedRequest, res) => {
  res.json(buildDashboard(req.userId!));
});

/* --------------------------- notifications --------------------------- */

miscRouter.get('/notifications', (req: AuthedRequest, res) => {
  // Self-maintaining: each poll runs one reminder pass so in-app notifications
  // materialize without needing a separate worker process in the MVP.
  runReminderTick();
  res.json({ notifications: listNotifications(req.userId!, req.query.unread === '1') });
});

miscRouter.post('/notifications/read', (req: AuthedRequest, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const updated = markNotificationsRead(req.userId!, ids);
  res.json({ updated });
});

/** Worker tick — in production this runs on a schedule (services/worker). */
miscRouter.post('/reminders/run', (req: AuthedRequest, res) => {
  const result = runReminderTick();
  audit(req.userId!, 'reminders.tick', 'system', undefined, { created: result.created.length }, req.ip);
  res.json(result);
});

/* ------------------------------ audit -------------------------------- */

miscRouter.get('/audit', (req: AuthedRequest, res) => {
  const rows = db.prepare('SELECT id, actor, event_type, resource_type, resource_id, metadata, ip, timestamp FROM audit_events WHERE actor = ? ORDER BY timestamp DESC LIMIT 200')
    .all(req.userId!) as Array<Record<string, unknown>>;
  res.json({
    events: rows.map((r) => ({
      ...r,
      metadata: r.metadata ? JSON.parse(String(r.metadata)) : null,
    })),
  });
});

/* -------------------------- consent center --------------------------- */

const PROVIDER_CATALOG: Record<string, { name: string; dataAccessed: string; whyNeeded: string; scopes: string[]; risk: string; oauth: boolean }> = {
  gmail_readonly: {
    name: 'Gmail (read-only receipts)',
    dataAccessed: 'Emails matching receipt/bill/renewal filters',
    whyNeeded: 'Discover bills, renewals and subscriptions automatically',
    scopes: ['gmail.readonly'],
    risk: 'High privacy',
    oauth: true,
  },
  google_calendar: {
    name: 'Google Calendar',
    dataAccessed: 'Event titles and times',
    whyNeeded: 'Travel readiness and appointment conflict checks',
    scopes: ['calendar.events.readonly'],
    risk: 'Medium',
    oauth: true,
  },
  email_forwarding: {
    name: 'Email forwarding address',
    dataAccessed: 'Only emails you explicitly forward to your LifeOS address',
    whyNeeded: 'Lowest-risk ingestion path for bills and policies (MVP default)',
    scopes: ['forwarded_email'],
    risk: 'Low',
    oauth: false,
  },
};

const oauthConfigured = (): boolean => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

miscRouter.get('/consent', (req: AuthedRequest, res) => {
  const rows = db.prepare('SELECT * FROM integrations WHERE owner_id = ?').all(req.userId!) as Array<Record<string, unknown>>;
  res.json({
    oauthConfigured: oauthConfigured(),
    catalog: Object.entries(PROVIDER_CATALOG).map(([key, v]) => ({ key, ...v })),
    connections: rows.map((r) => ({
      id: String(r.id),
      provider: String(r.provider),
      status: String(r.status),
      scopes: JSON.parse(String(r.scopes)) as string[],
      last_sync_at: r.last_sync_at,
      created_at: String(r.created_at),
    })),
  });
});

miscRouter.post('/consent/connect', (req: AuthedRequest, res) => {
  const provider = String(req.body?.provider ?? '');
  const meta = PROVIDER_CATALOG[provider];
  if (!meta) {
    res.status(400).json({ error: 'Unknown provider.' });
    return;
  }
  // Trust before growth (Core Principles): never fake a connection. OAuth
  // providers require real Google OAuth credentials; without them the API
  // refuses honestly instead of flipping a flag that does nothing.
  if (meta.oauth && !oauthConfigured()) {
    res.status(501).json({
      error: `${meta.name} requires Google OAuth to be configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Until then, use the email forwarding path — it is fully functional.`,
      code: 'oauth_not_configured',
    });
    return;
  }
  db.prepare(`INSERT INTO integrations (id, owner_id, provider, scopes, status, created_at)
              VALUES (?, ?, ?, ?, 'connected', ?)
              ON CONFLICT(owner_id, provider) DO UPDATE SET status = 'connected'`)
    .run(uuid(), req.userId!, provider, JSON.stringify(meta.scopes), nowISO());
  audit(req.userId!, 'consent.connected', 'integration', provider, { scopes: meta.scopes }, req.ip);
  res.json({ ok: true, provider, scopes: meta.scopes });
});

/* ------------------------- manual record entry ------------------------- */

/** Direct detail entry (no document) — e.g. typing PUC expiry by hand. */
miscRouter.post('/records/manual', (req: AuthedRequest, res) => {
  const category = String(req.body?.category ?? '');
  const title = String(req.body?.title ?? '').slice(0, 200) || 'Manual entry';
  const fields = (req.body?.fields ?? {}) as Record<string, unknown>;
  if (typeof fields !== 'object' || fields === null) {
    res.status(400).json({ error: 'fields object required.' });
    return;
  }
  const clean = Object.fromEntries(
    Object.entries(fields)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => [k, String(v).slice(0, 300)])
  );
  try {
    const result = createRecordsFromManual(req.userId!, category, title, clean);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

miscRouter.post('/consent/:provider/revoke', (req: AuthedRequest, res) => {
  db.prepare("UPDATE integrations SET status = 'revoked' WHERE owner_id = ? AND provider = ?")
    .run(req.userId!, req.params.provider);
  audit(req.userId!, 'consent.revoked', 'integration', req.params.provider, {}, req.ip);
  res.json({ ok: true });
});

/* ------------------------- email ingestion --------------------------- */

/**
 * Simulates the MVP forwarding-address path (§4.2): an MTA would POST here.
 * Supports sender allow-list filtering + dedupe by content hash.
 */
miscRouter.post('/ingest/email', (req: AuthedRequest, res) => {
  const parsed = IngestEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid email payload.', details: parsed.error.flatten() });
    return;
  }
  const { sender, subject, body } = parsed.data;

  if (config.emailAllowlist.length > 0 && !config.emailAllowlist.some((a) => sender.toLowerCase().endsWith(a))) {
    audit(req.userId!, 'email.rejected_sender', 'email', undefined, { sender }, req.ip);
    res.status(403).json({ error: `Sender "${sender}" is not on your allow-list.` });
    return;
  }

  const hash = sha256(`${sender}|${subject}|${body}`);
  const dup = db.prepare('SELECT id FROM ingest_emails WHERE owner_id = ? AND hash = ?').get(req.userId!, hash);
  if (dup) {
    res.status(200).json({ duplicate: true, message: 'This email was already processed.' });
    return;
  }

  const ingestId = uuid();
  db.prepare('INSERT INTO ingest_emails (id, owner_id, sender, subject, body, hash, received_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(ingestId, req.userId!, sender, subject, body, hash, parsed.data.receivedAt ?? nowISO(), nowISO());

  const result = ingestText({
    ownerId: req.userId!,
    title: subject,
    text: `From: ${sender}\nSubject: ${subject}\n\n${body}`,
    source: 'email_forward',
  });
  db.prepare('UPDATE ingest_emails SET processed_document_id = ? WHERE id = ?').run(result.document.id, ingestId);
  audit(req.userId!, 'email.ingested', 'document', result.document.id, { sender, category: result.document.category }, req.ip);
  res.status(201).json(result);
});

/* ------------------------ export & deletion -------------------------- */

miscRouter.get('/account/export', (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const dump = {
    exported_at: nowISO(),
    user: db.prepare('SELECT id, email, locale, timezone, status, mfa_enabled, created_at FROM users WHERE id = ?').get(userId),
    documents: db.prepare('SELECT id, title, category, source, status, created_at FROM documents WHERE owner_id = ?').all(userId),
    document_fields: db.prepare('SELECT df.* FROM document_fields df JOIN documents d ON d.id = df.document_id WHERE d.owner_id = ?').all(userId),
    assets: db.prepare('SELECT * FROM assets WHERE owner_id = ?').all(userId),
    obligations: db.prepare('SELECT * FROM obligations WHERE owner_id = ?').all(userId),
    subscriptions: db.prepare('SELECT * FROM subscriptions WHERE owner_id = ?').all(userId),
    events: db.prepare('SELECT * FROM events WHERE owner_id = ?').all(userId),
  };
  audit(userId, 'account.exported', 'user', userId, {}, req.ip);
  res.setHeader('Content-Disposition', 'attachment; filename="lifeos-export.json"');
  res.json(dump);
});

miscRouter.post('/account/delete', (req: AuthedRequest, res) => {
  const userId = req.userId!;
  // Retention note (Operational Policies): legal-hold categories would be
  // excluded by policy in production; MVP deletes all user-owned rows.
  audit(userId, 'account.deleted', 'user', userId, { at: nowISO() });
  db.prepare('DELETE FROM users WHERE id = ?').run(userId); // cascades via FK
  res.json({ ok: true, message: 'Account and personal data deleted.' });
});