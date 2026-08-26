/**
 * Reminder scheduling & notification generation (§2.6).
 *
 * A worker "tick" scans open obligations and materializes in-app notifications
 * for each configured days-before-due offset. Dedupe keys guarantee a user is
 * never notified twice for the same milestone (§2.6: dedupe across channels).
 */
import type { NotificationItem } from '@lifeos/types';
import { db, parseJSON } from '../db';
import { addDays, nowISO, uuid } from '../util';

export interface GeneratedReminder {
  notificationId: string;
  obligationId: string;
  title: string;
  body: string;
  offsetDays: number;
  dueAt: string;
}

/**
 * Run one reminder pass. For every open obligation whose due date falls within
 * an offset of its reminder policy, create a notification unless one already
 * exists for that (obligation, offset) pair.
 */
export function runReminderTick(now = new Date()): { created: GeneratedReminder[]; checked: number } {
  const rows = db.prepare("SELECT * FROM obligations WHERE status = 'open'").all() as Array<Record<string, unknown>>;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO notifications (id, user_id, obligation_id, kind, title, body, scheduled_for, sent_at, dedupe_key, status, created_at)
     VALUES (?, ?, ?, 'reminder', ?, ?, ?, ?, ?, 'sent', ?)`
  );
  const created: GeneratedReminder[] = [];

  for (const r of rows) {
    const obligationId = String(r.id);
    const userId = String(r.user_id ?? r.owner_id);
    const dueAt = new Date(String(r.due_at));
    const policy = parseJSON<number[]>(r.reminder_policy, [7]);
    const title = String(r.title);
    const detail = r.detail ? String(r.detail) : '';

    for (const offset of policy) {
      const fireAt = addDays(dueAt, -offset);
      if (fireAt > now) continue; // not yet scheduled
      if (dueAt < now && offset > 0) continue; // past-due: only same-day/overdue notice once

      const dedupeKey = `${obligationId}:${offset}`;
      const id = uuid();
      const whenLabel =
        offset === 0 ? 'due today' : offset === 1 ? 'due tomorrow' : `due in ${offset} days`;
      const body = `${title} — ${whenLabel}.${detail ? ` ${detail}` : ''}`;

      const res = insert.run(id, userId, obligationId, title, body, fireAt.toISOString(), nowISO(), dedupeKey, nowISO());
      if (res.changes > 0) {
        created.push({ notificationId: id, obligationId, title, body, offsetDays: offset, dueAt: dueAt.toISOString() });
      }
    }
  }
  return { created, checked: rows.length };
}

export function listNotifications(userId: string, unreadOnly = false): NotificationItem[] {
  let sql = 'SELECT * FROM notifications WHERE user_id = ?';
  if (unreadOnly) sql += " AND read_at IS NULL";
  sql += ' ORDER BY scheduled_for DESC LIMIT 200';
  const rows = db.prepare(sql).all(userId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    user_id: String(r.user_id),
    obligation_id: r.obligation_id ? String(r.obligation_id) : null,
    kind: r.kind as NotificationItem['kind'],
    title: String(r.title),
    body: String(r.body),
    scheduled_for: String(r.scheduled_for),
    sent_at: r.sent_at ? String(r.sent_at) : null,
    read_at: r.read_at ? String(r.read_at) : null,
    dedupe_key: String(r.dedupe_key),
    status: r.status as NotificationItem['status'],
  }));
}

export function markNotificationsRead(userId: string, ids: string[]): number {
  if (ids.length === 0) return 0;
  const stmt = db.prepare('UPDATE notifications SET read_at = ?, status = ? WHERE id = ? AND user_id = ? AND read_at IS NULL');
  let n = 0;
  const now = nowISO();
  for (const id of ids) {
    n += stmt.run(now, 'read', id, userId).changes;
  }
  return n;
}