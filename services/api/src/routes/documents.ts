/**
 * Document routes: upload/paste → extraction review → confirm/correct → derive.
 * Implements FR-003..FR-006 and UC-001's core loop.
 */
import { Router } from 'express';
import multer from 'multer';
import { ConfirmFieldsSchema } from '@lifeos/types';
import { requireAuth, type AuthedRequest } from '../auth';
import { db } from '../db';
import { config } from '../config';
import { ingestText, getDocument, listDocuments, listFields, excerptAround } from '../extraction/pipeline';
import { deriveRecordsFromDocument } from '../engine/obligations';
import { audit } from '../engine/tools';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
});

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

/** Upload pasted text or a text-based file; runs the full extraction pipeline. */
documentsRouter.post('/upload', upload.single('file'), (req: AuthedRequest, res) => {
  const userId = req.userId!;
  let title = '';
  let text = '';
  let source: 'upload' | 'email_forward' | 'manual' | 'csv_import' = 'upload';
  let mimeType = 'text/plain';

  if (req.file) {
    // File-type validation (§2.4 step 2). MVP accepts text-like files; PDF/image
    // OCR plugs in as a vendor-isolated parser per §7.1 threat model.
    const okTypes = ['text/plain', 'text/markdown', 'text/csv', 'application/json'];
    if (!okTypes.includes(req.file.mimetype)) {
      res.status(415).json({
        error: `Unsupported file type "${req.file.mimetype}". MVP accepts text files (.txt/.md/.csv); paste text for other formats.`,
      });
      return;
    }
    text = req.file.buffer.toString('utf8');
    title = req.body?.title || req.file.originalname;
    mimeType = req.file.mimetype;
  } else if (req.body && typeof req.body.text === 'string') {
    text = req.body.text;
    title = String(req.body.title || 'Pasted document');
    source = (req.body.source as typeof source) || 'manual';
  }

  if (text.trim().length < 10) {
    res.status(400).json({ error: 'Provide at least 10 characters of document text.' });
    return;
  }

  const result = ingestText({ ownerId: userId, title, text, source, mimeType });
  audit(userId, result.duplicate ? 'document.duplicate' : 'document.ingested', 'document', result.document.id, {
    category: result.document.category,
    fields: result.fields.length,
  }, req.ip);
  res.status(result.duplicate ? 200 : 201).json(result);
});

documentsRouter.get('/', (req: AuthedRequest, res) => {
  res.json({ documents: listDocuments(req.userId!) });
});

documentsRouter.get('/:id', (req: AuthedRequest, res) => {
  const doc = getDocument(req.userId!, req.params.id);
  if (!doc) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }
  const fields = listFields(doc.id);
  const rawRow = db.prepare('SELECT raw_text FROM documents WHERE id = ?').get(doc.id) as { raw_text: string };
  res.json({
    document: doc,
    fields,
    provenanceExcerpts: fields.map((f) => ({
      fieldId: f.id,
      field: f.field,
      excerpt: excerptAround(rawRow.raw_text, f.span_start, f.span_end),
    })),
  });
});

/** Correct an extracted field before confirmation (FR-006). */
documentsRouter.patch('/:id/fields/:fieldId', (req: AuthedRequest, res) => {
  const doc = getDocument(req.userId!, req.params.id);
  if (!doc) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }
  const value = String(req.body?.value ?? '').trim();
  if (!value) {
    res.status(400).json({ error: 'Value required.' });
    return;
  }
  db.prepare('UPDATE document_fields SET value = ?, normalized_value = NULL, confidence = 1.0 WHERE id = ? AND document_id = ?')
    .run(value, req.params.fieldId, doc.id);
  audit(req.userId!, 'document.field_corrected', 'document_field', req.params.fieldId, { value }, req.ip);
  res.json({ fields: listFields(doc.id) });
});

/**
 * Confirm fields (§2.4 step 9-10): marks them verified and derives structured
 * records — assets, subscriptions, obligations — with provenance preserved.
 */
documentsRouter.post('/:id/confirm', (req: AuthedRequest, res) => {
  const doc = getDocument(req.userId!, req.params.id);
  if (!doc) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }
  const parsed = ConfirmFieldsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload.', details: parsed.error.flatten() });
    return;
  }

  const apply = db.prepare('UPDATE document_fields SET value = ?, normalized_value = ?, confirmed = 1 WHERE id = ? AND document_id = ?');
  const allFields = listFields(doc.id);
  for (const incoming of parsed.data.fields) {
    const match = allFields.find((f) => f.field === incoming.field);
    if (match) {
      apply.run(incoming.value, match.normalized_value ?? incoming.value, match.id, doc.id);
    }
  }
  // Mark any remaining unconfirmed high-impact fields as confirmed-as-extracted
  // only when explicitly listed; others stay unconfirmed and are ignored by derivation.

  try {
    const derived = deriveRecordsFromDocument(req.userId!, doc.id);
    audit(req.userId!, 'document.confirmed', 'document', doc.id, {
      obligations: derived.obligations.length,
      assets: derived.assets.length,
      subscriptions: derived.subscriptions.length,
      events: derived.events.length,
    }, req.ip);
    res.json({ ok: true, derived });
  } catch (err) {
    res.status(500).json({ error: `Derivation failed: ${String(err)}` });
  }
});

documentsRouter.delete('/:id', (req: AuthedRequest, res) => {
  const doc = getDocument(req.userId!, req.params.id);
  if (!doc) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }
  // Guardrail §5.5: deletion of source records requires confirmation — enforced
  // client-side with a dialog; server logs the intent either way.
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  audit(req.userId!, 'document.deleted', 'document', doc.id, {}, req.ip);
  res.json({ ok: true });
});