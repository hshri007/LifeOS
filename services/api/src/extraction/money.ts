/**
 * Currency amount detection & normalization (§2.4 step 6).
 * Handles ₹ / Rs. / INR / $ / USD prefixes and Indian digit grouping (1,299.00).
 */
import type { ExtractedField } from '@lifeos/types';

export interface ParsedMoney {
  amount: number;
  currency: 'INR' | 'USD';
  span: [number, number];
  raw: string;
}

const CURRENCY_PREFIX = '(?:₹|rs\\.?|inr|\\$|usd)';

function normalizeAmount(numStr: string): number {
  return Number(numStr.replace(/,/g, ''));
}

/**
 * Find all currency amounts. Requires an explicit currency marker so bare
 * numbers (order ids, phone numbers) are never mistaken for money.
 */
export function findMonies(text: string): ParsedMoney[] {
  const out: ParsedMoney[] = [];
  const re = new RegExp(`${CURRENCY_PREFIX}[\\s]*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const marker = m[0].slice(0, m[0].length - m[1].length).toLowerCase();
    const currency = marker.includes('$') || marker.includes('usd') ? 'USD' : 'INR';
    out.push({
      amount: normalizeAmount(m[1]),
      currency,
      span: [m.index, m.index + m[0].length],
      raw: m[0],
    });
  }
  return out;
}

export function firstMoneyAfter(text: string, fromIndex: number, windowChars = 120): ParsedMoney | null {
  const end = Math.min(text.length, fromIndex + windowChars);
  return findMonies(text.slice(fromIndex, end))[0] ?? null;
}

export function moneyField(
  field: string,
  parsed: ParsedMoney,
  opts: { requiresConfirmation?: boolean } = {}
): ExtractedField {
  return {
    field,
    value: parsed.raw.trim(),
    normalizedValue: `${parsed.currency}:${parsed.amount}`,
    confidence: 0.9,
    span: parsed.span,
    requiresConfirmation: opts.requiresConfirmation ?? true,
  };
}