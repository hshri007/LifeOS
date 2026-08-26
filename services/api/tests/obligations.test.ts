/**
 * Obligation engine tests: recurrence roll-forward (FR-008), reminder
 * scheduling with dedupe (§2.6), and record derivation from confirmed
 * documents (UC-001). Runs against a throwaway SQLite database.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Isolated DB must be configured BEFORE importing any module that opens it.
const tmpDb = path.join(os.tmpdir(), `lifeos-test-${process.pid}-${Date.now()}.db`);
process.env.LIFEOS_DB_PATH = tmpDb;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { nextOccurrence, createObligation, deriveRecordsFromDocument } = require('../src/engine/obligations');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runReminderTick } = require('../src/engine/reminders');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ingestText, listFields } = require('../src/extraction/pipeline');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { db } = require('../src/db');

const OWNER = '00000000-0000-4000-8000-000000000001';

before(() => {
  db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(OWNER, 'test@lifeos.dev', 'x', new Date().toISOString());
});

test('recurrence roll-forward computes correct next dates', () => {
  assert.equal(nextOccurrence('2026-09-02T00:00:00.000Z', 'monthly'), '2026-10-02T00:00:00.000Z');
  assert.equal(nextOccurrence('2026-09-02T00:00:00.000Z', 'annual'), '2027-09-02T00:00:00.000Z');
  assert.equal(nextOccurrence('2026-01-31T00:00:00.000Z', 'monthly'), '2026-02-28T00:00:00.000Z'); // month-end clamp
});

test('completing a recurring obligation rolls forward instead of closing', () => {
  const ob = createObligation({
    ownerId: OWNER,
    type: 'payment',
    title: 'Test recurring bill',
    dueAt: '2026-08-20T00:00:00.000Z',
    recurrence: 'monthly',
  });
  const { updateObligationStatus } = require('../src/engine/obligations');
  const updated = updateObligationStatus(OWNER, ob.id, { status: 'completed' });
  assert.equal(updated.status, 'open');
  assert.equal(updated.due_at.slice(0, 10), '2026-09-20');
});

test('reminder tick generates notifications per policy offsets and dedupes', () => {
  // Due in 2 days with policy [3, 0]: offset 3 fired yesterday (creates now),
  // offset 0 fires on the due date (still in the future → not yet created).
  createObligation({
    ownerId: OWNER,
    type: 'renewal',
    title: 'Dedupe test renewal',
    dueAt: new Date(Date.now() + 2 * 86400000).toISOString(),
    reminderPolicy: [3, 0],
  });

  const first = runReminderTick();
  assert.equal(first.created.length, 1);
  assert.equal(first.created[0].offsetDays, 3);

  const second = runReminderTick();
  assert.equal(second.created.length, 0, 'second tick must not duplicate notifications');
});

test('UC-001: confirmed invoice derives asset + return + warranty obligations', () => {
  const invoiceText = `TechMart Electronics Pvt Ltd
Tax Invoice
Date of Purchase: 14 Aug 2026
Item: MacBook Air M3 13-inch
Total Amount: Rs. 92,900.00
Order ID: 5539021188
Returns accepted within 10 days of delivery.
Manufacturer warranty of 24 months from date of purchase.`;

  const { document } = ingestText({ ownerId: OWNER, title: 'MacBook invoice', text: invoiceText });
  assert.equal(document.category, 'purchase_invoice');

  // Simulate the user confirming every extracted field (§2.4 step 9).
  for (const f of listFields(document.id)) {
    db.prepare('UPDATE document_fields SET confirmed = 1 WHERE id = ?').run(f.id);
  }

  const derived = deriveRecordsFromDocument(OWNER, document.id);
  assert.equal(derived.assets.length, 1);
  assert.equal(derived.assets[0].type, 'electronics');

  const types = derived.obligations.map((o: { type: string }) => o.type).sort();
  assert.deepEqual(types, ['notice', 'return_deadline']);

  const ret = derived.obligations.find((o: { type: string }) => o.type === 'return_deadline');
  assert.equal(ret.due_at.slice(0, 10), '2026-08-24'); // purchase + 10 days

  const warranty = derived.obligations.find((o: { type: string }) => o.type === 'notice');
  assert.equal(warranty.due_at.slice(0, 10), '2028-08-14'); // purchase + 24 months

  // Provenance preserved (FR-005)
  assert.equal(ret.provenance.documentId, document.id);

  fs.rmSync(tmpDb, { force: true });
});