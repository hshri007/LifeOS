/**
 * Extraction pipeline (§2.4):
 *   receive → checks → parse/classify → extract → normalize → confidence
 *   → deterministic validation → persist for confirmation → provenance.
 *
 * Steps 9-10 (user confirmation, verified persistence) happen via confirmDocument()
 * which then delegates record derivation to the obligation engine.
 */
import type { DocumentCategory, DocumentRecord, DocumentField, ExtractionResult } from '@lifeos/types';
import { db, parseJSON } from '../db';
import { classify } from './classifier';
import { buildContext, extractFields } from './extractors';
import { uuid, nowISO, sha256 } from '../util';

export interface IngestResult {
  document: DocumentRecord;
  extraction: ExtractionResult;
  fields: DocumentField[];
  duplicate: boolean;
}

/**
 * Deterministic validation rules (§2.4 step 8).
 * Returns human-readable warnings; never silently mutates extracted values.
 */
export function validateExtraction(category: DocumentCategory, fields: Map<string, string>): string[] {
  const warnings: string[] = [];
  const iso = (name: string): string | undefined => {
    const raw = fields.get(name);
    if (!raw) return undefined;
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
  };

  const start = iso('start_date') ?? iso('purchase_date') ?? iso('lease_start');
  const end = iso('end_date') ?? iso('lease_end');
  if (start && end && end <= start) {
    warnings.push(`End date (${end}) is not after start date (${start}) — please verify.`);
  }

  for (const amountField of ['premium_amount', 'price_amount', 'amount', 'amount_due', 'monthly_rent']) {
    const v = fields.get(amountField);
    if (v !== undefined) {
      const n = Number(v.replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(n) || n <= 0) warnings.push(`${amountField} does not look like a positive amount.`);
    }
  }

  if (category === 'insurance' && !fields.has('end_date')) {
    warnings.push('No policy end date found — a renewal reminder cannot be created without it.');
  }
  if (category === 'bills' && !fields.has('due_date')) {
    warnings.push('No due date found — payment reminder cannot be scheduled.');
  }
  return warnings;
}

/** Field map keyed by name using normalized values where available. */
export function fieldMap(fields: Array<Pick<DocumentField, 'field' | 'value' | 'normalized_value'>>): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of fields) m.set(f.field, f.normalized_value || f.value);
  return m;
}

/**
 * Ingest raw text: hash/dedupe, classify, extract, persist as `extracted`
 * awaiting user confirmation. Returns everything the UI needs to render review.
 */
export function ingestText(opts: {
  ownerId: string;
  title: string;
  text: string;
  source?: 'upload' | 'email_forward' | 'manual' | 'csv_import';
  mimeType?: string;
}): IngestResult {
  const { ownerId, title, text } = opts;
  const source = opts.source ?? 'upload';
  const mimeType = opts.mimeType ?? 'text/plain';
  const hash = sha256(text);

  // Deduplication (§4.2): identical content from same owner is not re-ingested.
  const existing = db
    .prepare('SELECT id FROM documents WHERE owner_id = ? AND hash = ?')
    .get(ownerId, hash) as { id: string } | undefined;

  if (existing) {
    const doc = getDocument(ownerId, existing.id)!;
    return {
      document: doc,
      extraction: { category: doc.category as DocumentCategory, classificationScores: [], fields: [], warnings: ['Duplicate of an already-ingested document.'] },
      fields: listFields(existing.id),
      duplicate: true,
    };
  }

  const { category, scores } = classify(text);
  const ctx = buildContext(text);
  const extracted = extractFields(category, ctx);
  const warnings = validateExtraction(
    category,
    new Map(extracted.map((f) => [f.field, f.normalizedValue ?? f.value]))
  );

  const docId = uuid();
  const now = nowISO();
  db.prepare(
    `INSERT INTO documents (id, owner_id, title, category, source, mime_type, size_bytes, hash, storage_ref, status, raw_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'extracted', ?, ?)`
  ).run(docId, ownerId, title, category, source, mimeType, Buffer.byteLength(text), hash, `mem://${docId}`, text, now);

  const insertField = db.prepare(
    `INSERT INTO document_fields (id, document_id, field, value, normalized_value, confidence, span_start, span_end, requires_confirmation, confirmed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  );
  for (const f of extracted) {
    insertField.run(uuid(), docId, f.field, f.value, f.normalizedValue ?? null, f.confidence, f.span[0], f.span[1], f.requiresConfirmation ? 1 : 0, now);
  }

  return {
    document: getDocument(ownerId, docId)!,
    extraction: { category, classificationScores: scores, fields: extracted, warnings },
    fields: listFields(docId),
    duplicate: false,
  };
}

/* --------------------------- queries ---------------------------- */

const rowToDoc = (r: Record<string, unknown>): DocumentRecord => ({
  id: String(r.id),
  owner_id: String(r.owner_id),
  title: String(r.title),
  category: r.category as DocumentCategory,
  source: r.source as DocumentRecord['source'],
  mime_type: String(r.mime_type),
  size_bytes: Number(r.size_bytes),
  hash: String(r.hash),
  storage_ref: String(r.storage_ref),
  status: r.status as DocumentRecord['status'],
  created_at: String(r.created_at),
});

export function getDocument(ownerId: string, docId: string): DocumentRecord | null {
  const r = db.prepare('SELECT * FROM documents WHERE id = ? AND owner_id = ?').get(docId, ownerId) as Record<string, unknown> | undefined;
  return r ? rowToDoc(r) : null;
}

export function listDocuments(ownerId: string, limit = 100): DocumentRecord[] {
  const rows = db.prepare('SELECT * FROM documents WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?').all(ownerId, limit) as Array<Record<string, unknown>>;
  return rows.map(rowToDoc);
}

const rowToField = (r: Record<string, unknown>): DocumentField => ({
  id: String(r.id),
  document_id: String(r.document_id),
  field: String(r.field),
  value: String(r.value),
  normalized_value: r.normalized_value ? String(r.normalized_value) : null,
  confidence: Number(r.confidence),
  span_start: Number(r.span_start),
  span_end: Number(r.span_end),
  requires_confirmation: Boolean(r.requires_confirmation),
  confirmed: Boolean(r.confirmed),
});

export function listFields(documentId: string): DocumentField[] {
  const rows = db.prepare('SELECT * FROM document_fields WHERE document_id = ? ORDER BY confidence DESC').all(documentId) as Array<Record<string, unknown>>;
  return rows.map(rowToField);
}

/** Source excerpt around a span — used by assistant provenance & UI highlight (FR-005). */
export function excerptAround(rawText: string, start: number, end: number, pad = 60): string {
  const s = Math.max(0, start - pad);
  const e = Math.min(rawText.length, end + pad);
  return `${s > 0 ? '…' : ''}${rawText.slice(s, e)}${e < rawText.length ? '…' : ''}`;
}

export { rowToDoc, rowToField, parseJSON };