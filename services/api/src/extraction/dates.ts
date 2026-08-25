/**
 * Date detection & normalization (§2.4 step 6).
 *
 * Deterministic, testable parsing of the common formats found in Indian and
 * global documents: ISO, DD/MM/YYYY, "26 Aug 2026", "Aug 26, 2026".
 * Every match carries a confidence score and a character span for provenance.
 */
import type { ExtractedField } from '@lifeos/types';

export interface ParsedDate {
  iso: string; // YYYY-MM-DD
  confidence: number;
  span: [number, number];
  raw: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

function validUTC(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

interface Rule {
  re: RegExp;
  confidence: number;
  build: (m: RegExpExecArray) => { iso: string } | null;
}

/** Ordered by specificity/priority; first matching rule wins for a given span. */
const RULES: Rule[] = [
  {
    // 2026-08-26
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    confidence: 0.98,
    build: (m) => {
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      return validUTC(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}` } : null;
    },
  },
  {
    // 26 Aug 2026 | 26 August 2026
    re: new RegExp(`\\b(\\d{1,2})[ \\-](${MONTH_RE})\\.?,?[ \\-](\\d{4})\\b`, 'gi'),
    confidence: 0.95,
    build: (m) => {
      const d = Number(m[1]);
      const mo = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
      const y = Number(m[3]);
      return mo && validUTC(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}` } : null;
    },
  },
  {
    // Aug 26, 2026 | August 26 2026
    re: new RegExp(`\\b(${MONTH_RE})\\.?[ ](\\d{1,2})(?:st|nd|rd|th)?,?[ ](\\d{4})\\b`, 'gi'),
    confidence: 0.93,
    build: (m) => {
      const mo = MONTHS[m[1].toLowerCase().slice(0, 4)] ?? MONTHS[m[1].toLowerCase().slice(0, 3)];
      const d = Number(m[2]);
      const y = Number(m[3]);
      return mo && validUTC(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}` } : null;
    },
  },
  {
    // 26/08/2026 | 26-08-2026 | 26.08.2026 (DD/MM assumed; swapped if impossible)
    re: /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/g,
    confidence: 0.85,
    build: (m) => {
      let d = Number(m[1]);
      let mo = Number(m[2]);
      const y = Number(m[3]);
      let conf = 0.85;
      if (d > 12 && mo <= 12) {
        // already DD/MM
      } else if (mo > 12 && d <= 12) {
        [d, mo] = [mo, d]; // was MM/DD
        conf = 0.75;
      }
      return validUTC(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}` } : null;
    },
  },
];

/**
 * Find all parseable dates in text. Overlapping matches keep the higher-confidence one.
 */
export function findDates(text: string): ParsedDate[] {
  const out: ParsedDate[] = [];
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const built = rule.build(m);
      if (!built) continue;
      const start = m.index;
      const end = start + m[0].length;
      // Skip if overlapping an existing higher/equal confidence match.
      const overlaps = out.some((p) => start < p.span[1] && end > p.span[0]);
      if (overlaps) continue;
      out.push({ iso: built.iso, confidence: rule.confidence, span: [start, end], raw: m[0] });
    }
  }
  return out.sort((a, b) => a.span[0] - b.span[0]);
}

/** First date whose raw match appears after `fromIndex` within `windowChars`. */
export function firstDateAfter(text: string, fromIndex: number, windowChars = 140): ParsedDate | null {
  const end = Math.min(text.length, fromIndex + windowChars);
  return findDates(text.slice(fromIndex, end))[0] ?? null;
}

export function dateField(
  field: string,
  parsed: ParsedDate,
  opts: { requiresConfirmation?: boolean } = {}
): ExtractedField {
  return {
    field,
    value: parsed.raw,
    normalizedValue: parsed.iso,
    confidence: parsed.confidence,
    span: parsed.span,
    requiresConfirmation: opts.requiresConfirmation ?? true,
  };
}