/**
 * Per-category field extraction (§2.3 extracted-fields table, §2.4 step 5).
 *
 * Every field carries: raw value, normalized value, confidence 0..1 and the exact
 * character span in the source text (provenance, FR-005). High-impact fields
 * (dates, amounts, identifiers used to create obligations) require user
 * confirmation before records are derived (§2.4 step 9).
 */
import type { DocumentCategory, ExtractedField } from '@lifeos/types';
import { dateField, firstDateAfter, findDates, type ParsedDate } from './dates';
import { moneyField, firstMoneyAfter, findMonies, type ParsedMoney } from './money';

export interface ExtractContext {
  text: string;
  lower: string;
  dates: ParsedDate[];
  monies: ParsedMoney[];
}

export function buildContext(text: string): ExtractContext {
  return { text, lower: text.toLowerCase(), dates: findDates(text), monies: findMonies(text) };
}

/* --------------------------- helpers --------------------------- */

function captureField(
  pattern: RegExp,
  ctx: ExtractContext,
  field: string,
  opts: {
    confidence?: number;
    requiresConfirmation?: boolean;
    normalize?: (v: string) => string;
  } = {}
): ExtractedField | null {
  const re = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  const m = re.exec(ctx.text);
  if (!m || m[1] === undefined) return null;
  const value = String(m[1]).trim();
  if (!value || value.length > 200) return null;
  const relIdx = m[0].indexOf(m[1]);
  const start = m.index + (relIdx >= 0 ? relIdx : 0);
  return {
    field,
    value,
    normalizedValue: opts.normalize ? opts.normalize(value) : undefined,
    confidence: opts.confidence ?? 0.8,
    span: [start, start + value.length],
    requiresConfirmation: opts.requiresConfirmation ?? false,
  };
}

function labeledDate(pattern: RegExp, ctx: ExtractContext, field: string): ExtractedField | null {
  const re = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  const m = re.exec(ctx.text);
  if (!m) return null;
  const parsed = firstDateAfter(ctx.text, m.index + m[0].length);
  return parsed ? dateField(field, parsed) : null;
}

function labeledMoney(pattern: RegExp, ctx: ExtractContext, field: string): ExtractedField | null {
  const re = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  const m = re.exec(ctx.text);
  if (!m) return null;
  const parsed = firstMoneyAfter(ctx.text, m.index + m[0].length);
  return parsed ? moneyField(field, parsed) : null;
}

/** First non-empty line as a weak merchant/title guess. */
function firstLineGuess(ctx: ExtractContext, field: string): ExtractedField | null {
  const line = ctx.text.split('\n').map((l) => l.trim()).find((l) => l.length >= 3);
  if (!line || line.length > 60) return null;
  return {
    field,
    value: line,
    confidence: 0.45,
    span: [ctx.text.indexOf(line), ctx.text.indexOf(line) + line.length],
    requiresConfirmation: true,
  };
}

const parseMonths = (v: string): string => {
  const m = v.match(/(\d{1,2})\s*(years?|months?)/i);
  if (!m) return v;
  const n = Number(m[1]);
  return String(/year/i.test(m[2]) ? n * 12 : n);
};

/* ------------------------ category rules ----------------------- */

type Extractor = (ctx: ExtractContext) => ExtractedField[];

const EXTRACTORS: Partial<Record<DocumentCategory, Extractor>> = {
  insurance: (c) =>
    [
      captureField(/(?:insurer|insurance provider|company)\s*[:\-]\s*([A-Z][A-Za-z&.' ]{2,40})/, c, 'provider'),
      captureField(/\bpolicy\s*(?:no\.?|number|#)?\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-\/]{4,24})/i, c, 'policy_number', { confidence: 0.85 }),
      labeledMoney(/premium(?:\s*amount|\s*\(?incl[^)]*\)?)?\s*[:\-]?/i, c, 'premium_amount'),
      labeledDate(/(?:policy period|period of insurance|valid from|commencing|start date|cover from)\s*[:\-]?/i, c, 'start_date'),
      labeledDate(/(?:valid (?:till|until|upto|up to)|expiry|expires? on|end date|cover up to)\s*[:\-]?/i, c, 'end_date'),
      captureField(/(?:insured name|insured)\s*[:\-]\s*([^\n]{2,60})/i, c, 'insured_name'),
    ].filter(Boolean) as ExtractedField[],

  purchase_invoice: (c) =>
    [
      captureField(/(?:merchant|sold by|billed by|seller|store)\s*[:\-]\s*([^\n]{2,50})/i, c, 'merchant'),
      firstLineGuess(c, 'merchant'),
      captureField(/(?:item|product|description)\s*[:\-]\s*([^\n]{2,80})/i, c, 'item_name'),
      labeledMoney(/(?:grand total|total amount|amount paid|order total|total)\s*[:\-]?/i, c, 'price_amount'),
      labeledDate(/(?:date of purchase|purchase date|invoice date|order date|dated)\s*[:\-]?/i, c, 'purchase_date'),
      captureField(/(?:order\s*(?:id|no\.?|number)?|#)\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-\/]{4,24})/i, c, 'order_id', { confidence: 0.75 }),
      captureField(/(?:return|replace)[^\n]{0,60}?within\s+(\d{1,3})\s*days?/i, c, 'return_window_days', {
        confidence: 0.85,
        requiresConfirmation: true,
        normalize: (v) => v.match(/\d+/)?.[0] ?? v,
      }),
      captureField(/warranty[^\n]{0,60}?(\d{1,2}\s*(?:years?|months?))/i, c, 'warranty_duration_months', {
        confidence: 0.85,
        requiresConfirmation: true,
        normalize: parseMonths,
      }),
    ].filter(Boolean) as ExtractedField[],

  warranty: (c) =>
    [
      captureField(/(?:covered (?:item|product)|product|appliance|device)\s*[:\-]\s*([^\n]{2,60})/i, c, 'covered_item'),
      captureField(/(?:provider|serviced by|company|vendor)\s*[:\-]\s*([^\n]{2,50})/i, c, 'provider'),
      labeledDate(/(?:start date|effective|commencing|from)\s*[:\-]?/i, c, 'start_date'),
      labeledDate(/(?:end date|valid (?:till|until)|expiry|expires? on)\s*[:\-]?/i, c, 'end_date'),
      captureField(/warranty[^\n]{0,60}?(\d{1,2}\s*(?:years?|months?))/i, c, 'duration_months', {
        confidence: 0.85,
        requiresConfirmation: true,
        normalize: parseMonths,
      }),
    ].filter(Boolean) as ExtractedField[],

  vehicle: (c) =>
    [
      captureField(/\b((?:[A-Z]{2}[\s\-]?\d{1,2}[\s\-]?[A-Z]{1,3}[\s\-]?\d{4}))\b/, c, 'registration_number', { confidence: 0.9 }),
      captureField(/(?:make\s*(?:\/|and)?\s*model|vehicle(?:\s*model)?)\s*[:\-]\s*([^\n]{2,60})/i, c, 'make_model'),
      labeledDate(/puc[^\n]{0,40}/i, c, 'puc_expiry'),
      labeledDate(/(?:insurance valid|insurance expiry|policy expiry|valid (?:till|until))\s*[:\-]?/i, c, 'insurance_expiry'),
      labeledDate(/(?:next service|service due|next service due)\s*(?:date)?\s*[:\-]?/i, c, 'next_service_date'),
      captureField(/odometer[^\d]{0,12}(\d{1,7})\s*km/i, c, 'odometer_km', { normalize: (v) => v }),
    ].filter(Boolean) as ExtractedField[],

  travel: (c) =>
    [
      captureField(/(?:passenger|traveller|traveler|guest)\s*[:\-]\s*([^\n]{2,60})/i, c, 'traveller'),
      captureField(/destination\s*[:\-]\s*([A-Za-z ,]{2,40})/i, c, 'destination'),
      labeledDate(/(?:departure|departing|flight date|onward journey)\s*[:\-]?/i, c, 'departure_date'),
      labeledDate(/(?:return|returning|inbound)\s*[:\-]?/i, c, 'return_date'),
      captureField(/\b(?:PNR|booking ref(?:erence)?)\s*[:\-#]?\s*([A-Z0-9]{5,8})\b/i, c, 'confirmation_code', { confidence: 0.85 }),
    ].filter(Boolean) as ExtractedField[],

  subscription: (c) =>
    [
      captureField(/(?:merchant|provider|service|paid to)\s*[:\-]\s*([^\n]{2,40})/i, c, 'merchant'),
      firstLineGuess(c, 'merchant'),
      labeledMoney(/(?:amount|price|plan cost|total)\s*[:\-]?/i, c, 'amount'),
      labeledDate(/(?:renewal(?: date)?|renews on|next billing|next payment|auto.?debit on)\s*[:\-]?/i, c, 'renewal_date'),
      captureField(/\b(monthly|annual|yearly|quarterly|per month|per year|every month|every year)\b/i, c, 'cadence', {
        confidence: 0.8,
        requiresConfirmation: true,
        normalize: (v) => {
          const s = v.toLowerCase();
          if (/month/.test(s)) return 'monthly';
          if (/quarter/.test(s)) return 'quarterly';
          return 'annual';
        },
      }),
    ].filter(Boolean) as ExtractedField[],

  bills: (c) =>
    [
      captureField(/(?:issuer|billed by|utility|board)\s*[:\-]\s*([^\n]{2,50})/i, c, 'issuer'),
      captureField(/\b(electricity|water|gas|internet|broadband|mobile|credit card)\b/i, c, 'bill_type', {
        confidence: 0.75,
        normalize: (v) => v.toLowerCase(),
      }),
      labeledMoney(/(?:amount due|total due|net payable|bill amount|payable)\s*[:\-]?/i, c, 'amount_due'),
      labeledDate(/(?:due date|due by|pay by|payment due|last date)\s*[:\-]?/i, c, 'due_date'),
      captureField(/(?:consumer no|account no\.?|customer id)\s*[:\-#]?\s*([A-Z0-9\-]{4,20})/i, c, 'account_number', {
        confidence: 0.7,
        // §7.2: identity/account material is highly sensitive — store masked display form.
        normalize: (v) => (v.length > 4 ? `${v.slice(0, 2)}${'*'.repeat(Math.max(v.length - 4, 0))}${v.slice(-2)}` : '****'),
      }),
    ].filter(Boolean) as ExtractedField[],

  property: (c) =>
    [
      captureField(/(?:property|premises|address)\s*[:\-]\s*([^\n]{5,120})/i, c, 'property_address'),
      labeledMoney(/(?:monthly rent|rent)\s*[:\-]?/i, c, 'monthly_rent'),
      labeledMoney(/maintenance\s*[:\-]?/i, c, 'maintenance_amount'),
      labeledDate(/(?:lease (?:start|commencement)|agreement date|from)\s*[:\-]?/i, c, 'lease_start'),
      labeledDate(/(?:lease end|lease expiry|valid (?:till|until)|ending on)\s*[:\-]?/i, c, 'lease_end'),
    ].filter(Boolean) as ExtractedField[],
};

/**
 * Run category-specific extraction, then add generic fallbacks so even an
 * 'other' document yields useful candidates (document_date, amounts).
 */
export function extractFields(category: DocumentCategory, ctx: ExtractContext): ExtractedField[] {
  const base = EXTRACTORS[category]?.(ctx) ?? [];
  const byName = new Map<string, ExtractedField>();
  for (const f of base) {
    const existing = byName.get(f.field);
    if (!existing || f.confidence > existing.confidence) byName.set(f.field, f);
  }

  if (!byName.has('document_date') && ctx.dates.length > 0) {
    byName.set('document_date', dateField('document_date', ctx.dates[0], { requiresConfirmation: false }));
  }
  if (!byName.has('notable_amount') && ctx.monies.length > 0 && !['purchase_invoice', 'subscription', 'bills', 'insurance', 'property'].includes(category)) {
    byName.set('notable_amount', moneyField('notable_amount', ctx.monies[0], { requiresConfirmation: false }));
  }

  return [...byName.values()].sort((a, b) => b.confidence - a.confidence);
}