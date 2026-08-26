/**
 * Demo seed: creates the demo user, ingests the sample documents, simulates
 * field confirmation (§2.4 step 9), derives records and runs one reminder tick.
 *
 * Run: npm run seed   (demo@lifeos.app / LifeOS!demo123)
 */
import { db } from './src/db';
import { hashPassword, nowISO, uuid } from './src/util';
import { ingestText, listFields } from './src/extraction/pipeline';
import { deriveRecordsFromDocument } from './src/engine/obligations';
import { runReminderTick } from './src/engine/reminders';
import { SAMPLE_DOCS } from './src/extraction/samples';

const DEMO_EMAIL = 'demo@lifeos.app';
const DEMO_PASSWORD = 'LifeOS!demo123';

function ensureDemoUser(): string {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL) as { id: string } | undefined;
  if (existing) {
    console.log(`Demo user already exists: ${DEMO_EMAIL}`);
    return existing.id;
  }
  const id = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, locale, timezone, status, mfa_enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
    .run(id, DEMO_EMAIL, hashPassword(DEMO_PASSWORD), 'en-IN', 'Asia/Kolkata', 'active', nowISO());
  db.prepare('INSERT INTO profiles (user_id, display_name, preferences) VALUES (?, ?, ?)')
    .run(id, 'Demo User', '{}');
  console.log(`Created demo user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  return id;
}

function main(): void {
  const userId = ensureDemoUser();

  let totalObligations = 0;
  for (const sample of SAMPLE_DOCS) {
    const existingDoc = db.prepare('SELECT id FROM documents WHERE owner_id = ? AND title = ?').get(userId, sample.title) as { id: string } | undefined;
    if (existingDoc) {
      console.log(`↷ skip (already seeded): ${sample.title}`);
      continue;
    }

    const { document, extraction } = ingestText({ ownerId: userId, title: sample.title, text: sample.text });
    // Simulate the user reviewing and confirming every extracted field.
    for (const f of listFields(document.id)) {
      db.prepare('UPDATE document_fields SET confirmed = 1 WHERE id = ?').run(f.id);
    }
    const derived = deriveRecordsFromDocument(userId, document.id);
    totalObligations += derived.obligations.length;

    console.log(
      `✓ ${sample.title}\n` +
      `    category=${document.category}, fields=${extraction.fields.length}` +
      `, +${derived.assets.length} assets, +${derived.subscriptions.length} subscriptions` +
      `, +${derived.events.length} events, +${derived.obligations.length} obligations`
    );
  }

  const tick = runReminderTick();
  console.log(`\nReminder tick: checked ${tick.checked} obligations, generated ${tick.created.length} notification(s).`);
  console.log(`Total obligations created this run: ${totalObligations}`);
  console.log('\nNext steps:');
  console.log(`  1. npm run dev:api   → http://localhost:4000`);
  console.log(`  2. npm run dev:web   → http://localhost:5173`);
  console.log(`  3. Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main();