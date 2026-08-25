/**
 * Document classification (§2.4 step 4, categories from §2.3).
 * Deterministic keyword-weight scoring — explainable by design (Core Principle:
 * "every extracted fact and recommendation should have a source and confidence").
 */
import { DOCUMENT_CATEGORIES, type ClassificationScore, type DocumentCategory } from '@lifeos/types';

interface CategoryKeywords {
  /** keyword → weight */
  [keyword: string]: number;
}

const KEYWORDS: Partial<Record<DocumentCategory, CategoryKeywords>> = {
  insurance: {
    policy: 3, premium: 3, insured: 2, coverage: 2, 'sum assured': 3,
    insurer: 3, nominee: 2, 'policy period': 3, idv: 2, deductible: 1,
  },
  purchase_invoice: {
    invoice: 3, 'order id': 3, 'order no': 3, 'bill to': 2, gstin: 2,
    purchased: 2, 'total amount': 2, qty: 1, sku: 2, merchant: 2, receipt: 2,
  },
  warranty: {
    warranty: 4, guarantee: 3, amc: 3, 'covered under': 2, 'warranty period': 4,
    'extended warranty': 4, claim: 1,
  },
  vehicle: {
    puc: 4, rc: 2, registration: 2, chassis: 3, 'engine no': 3, odometer: 3,
    vehicle: 3, 'driving licence': 1, fuel: 1, 'make model': 2, km: 1,
  },
  travel: {
    flight: 3, pnr: 4, boarding: 3, itinerary: 3, 'check-in': 2, hotel: 2,
    visa: 3, departure: 3, arrival: 2, terminal: 2, booking: 2, trip: 2,
  },
  subscription: {
    subscription: 4, plan: 2, renewal: 3, 'auto-debit': 3, membership: 3,
    streaming: 2, 'next billing': 3, autopay: 3, mandate: 2,
  },
  bills: {
    'due date': 3, bill: 2, statement: 2, electricity: 3, 'amount due': 3,
    'minimum due': 3, 'credit card': 2, meter: 2, units: 1, tariff: 2,
  },
  property: {
    rent: 3, lease: 3, tenant: 3, landlord: 3, maintenance: 2, deposit: 2,
    'lessor': 2, 'lessee': 2, premises: 2,
  },
};

export function classify(text: string): { category: DocumentCategory; scores: ClassificationScore[] } {
  const lower = text.toLowerCase();
  const scores: ClassificationScore[] = [];

  for (const category of DOCUMENT_CATEGORIES) {
    const kws = KEYWORDS[category];
    let score = 0;
    if (kws) {
      for (const [kw, weight] of Object.entries(kws)) {
        const hits = lower.split(kw).length - 1;
        if (hits > 0) score += weight * Math.min(hits, 3);
      }
    }
    scores.push({ category, score });
  }

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const category: DocumentCategory = top && top.score > 0 ? top.category : 'other';
  return { category, scores };
}