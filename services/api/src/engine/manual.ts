/**
 * Manual record creation (user request: "what if a user doesn't want to add
 * the document, they want to add the details directly" — e.g. a PUC renewal).
 * Mirrors the derivation rules of deriveRecordsFromDocument without requiring
 * a source document.
 */
import type { AssetType, Cadence, DocumentCategory, EventItem, Obligation, Subscription } from '@lifeos/types';
import { db } from '../db';
import { addDays, addMonths, uuid, nowISO } from '../util';
import { createAsset, createEvent, createObligation, upsertSubscription } from './obligations';
import { audit } from './tools';

export interface ManualRecords {
  assets: Array<{ id: string; name: string; type: string }>;
  subscriptions: Subscription[];
  events: EventItem[];
  obligations: Obligation[];
}

const iso = (v?: string): string | null =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : null;

const num = (v?: string): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Amount fields arrive as plain numbers from manual forms → `CUR:amount`. */
const money = (f: Record<string, string>, key: string): string | undefined => {
  const n = num(f[key]);
  return n === null ? undefined : `${f.currency === 'USD' ? 'USD' : 'INR'}:${n}`;
};

const MANUAL_CATEGORIES: DocumentCategory[] = [
  'insurance', 'purchase_invoice', 'warranty', 'vehicle', 'travel', 'subscription', 'bills', 'property',
];

export function createRecordsFromManual(
  ownerId: string,
  category: string,
  title: string,
  f: Record<string, string>
): ManualRecords {
  if (!MANUAL_CATEGORIES.includes(category as DocumentCategory)) {
    throw new Error(`Unsupported category "${category}".`);
  }
  const result: ManualRecords = { assets: [], subscriptions: [], events: [], obligations: [] };

  switch (category) {
    case 'vehicle': {
      const reg = f.registration_number;
      const name = f.make_model || (reg ? `Vehicle ${reg}` : title);
      let asset = reg
        ? db.prepare("SELECT id, type, name FROM assets WHERE owner_id = ? AND type = 'vehicle' AND json_extract(metadata, '$.registration_number') = ?")
            .get(ownerId, reg) as { id: string; type: string; name: string } | undefined
        : undefined;
      if (!asset) {
        const created = createAsset(ownerId, 'vehicle', name, {
          registration_number: reg, make_model: f.make_model, odometer_km: num(f.odometer_km),
        });
        result.assets.push({ id: created.id, name: created.name, type: created.type });
        asset = { id: created.id, type: created.type, name: created.name };
      }
      const puc = iso(f.puc_expiry);
      if (puc) {
        result.obligations.push(createObligation({
          ownerId, type: 'renewal', assetId: asset.id,
          title: `PUC renewal: ${asset.name}`, detail: 'Pollution-under-control certificate expires.',
          dueAt: puc, priority: 'high', recurrence: 'semiannual',
        }));
      }
      const ins = iso(f.insurance_expiry);
      if (ins) {
        result.obligations.push(createObligation({
          ownerId, type: 'renewal', assetId: asset.id,
          title: `Vehicle insurance renewal: ${asset.name}`, detail: 'Third-party/comprehensive policy expires.',
          dueAt: ins, priority: 'critical', recurrence: 'annual',
        }));
      }
      const svc = iso(f.next_service_date);
      if (svc) {
        result.obligations.push(createObligation({
          ownerId, type: 'service', assetId: asset.id,
          title: `Service due: ${asset.name}`, detail: 'Scheduled maintenance.',
          dueAt: svc, priority: 'medium',
        }));
      }
      break;
    }

    case 'insurance': {
      const end = iso(f.end_date);
      if (end) {
        result.obligations.push(createObligation({
          ownerId, type: 'renewal',
          title: `Insurance renewal: ${f.provider || 'Insurer'}`,
          detail: `Policy ${f.policy_number || ''} expires ${f.end_date}. Renew before expiry to avoid a coverage gap.`,
          dueAt: end, priority: 'high', recurrence: 'annual',
          actionPlan: 'Compare renewal quotes, then renew with the insurer or an aggregator.',
        }));
      }
      break;
    }

    case 'subscription': {
      const merchant = f.merchant || title;
      const amount = money(f, 'amount') ?? 'INR:0';
      const renewal = iso(f.renewal_date) ?? addDays(new Date(), 30).toISOString();
      const cadence = (['monthly', 'quarterly', 'semiannual', 'annual'].includes(f.cadence ?? '') ? f.cadence : 'monthly') as Cadence;
      const sub = upsertSubscription({
        owner_id: ownerId, merchant, amount: Number(amount.split(':')[1]), currency: amount.split(':')[0],
        cadence, renewal_at: renewal, category: f.category || 'general', status: 'active', document_id: null,
      });
      result.subscriptions.push(sub);
      result.obligations.push(createObligation({
        ownerId, type: 'renewal',
        title: `${merchant} renews (${cadence})`,
        detail: `Recurring charge ${amount.replace(':', ' ')}. Cancel or manage before renewal if unwanted.`,
        dueAt: renewal, priority: 'low',
        recurrence: cadence === 'monthly' ? 'monthly' : cadence === 'quarterly' ? 'quarterly' : 'annual',
      }));
      break;
    }

    case 'bills': {
      const due = iso(f.due_date);
      if (due) {
        const amt = money(f, 'amount_due') ?? 'INR:0';
        result.obligations.push(createObligation({
          ownerId, type: 'payment',
          title: `Pay ${f.issuer || f.bill_type || 'bill'}`,
          detail: `Amount due ${amt.replace(':', ' ')}.`,
          dueAt: due, priority: 'high',
          actionPlan: 'Pay via the issuer app/bank before the due date to avoid late fees.',
        }));
      }
      break;
    }

    case 'purchase_invoice': {
      const itemName = f.item_name || f.merchant || title;
      const purchase = iso(f.purchase_date);
      const asset = createAsset(ownerId, (f.asset_type as AssetType) || 'electronics', itemName, {
        purchase_date: f.purchase_date, price_amount: money(f, 'price_amount'), merchant: f.merchant,
      });
      result.assets.push({ id: asset.id, name: asset.name, type: asset.type });
      const windowDays = num(f.return_window_days);
      if (purchase && windowDays) {
        result.obligations.push(createObligation({
          ownerId, type: 'return_deadline', assetId: asset.id,
          title: `Return window closes: ${itemName}`,
          detail: `Return accepted within ${windowDays} days of purchase.`,
          dueAt: addDays(purchase, windowDays), priority: 'high',
          actionPlan: 'Decide whether to keep the item; if returning, start the return with the merchant before this date.',
        }));
      }
      const wMonths = num(f.warranty_duration_months);
      if (purchase && wMonths) {
        result.obligations.push(createObligation({
          ownerId, type: 'notice', assetId: asset.id,
          title: `Warranty ends: ${itemName}`,
          detail: `${wMonths} months warranty from purchase. File any claim before this date.`,
          dueAt: addMonths(purchase, wMonths), priority: 'medium',
          actionPlan: 'If the product fails before this date, gather the invoice and contact support.',
        }));
      }
      break;
    }

    case 'warranty': {
      const end = iso(f.end_date);
      if (end) {
        result.obligations.push(createObligation({
          ownerId, type: 'notice',
          title: `Warranty/AMC ends: ${f.covered_item || title}`,
          detail: `Provider ${f.provider || 'n/a'}.`,
          dueAt: end, priority: 'medium',
        }));
      }
      break;
    }

    case 'travel': {
      const dep = iso(f.departure_date);
      const ret = iso(f.return_date);
      if (dep) {
        const dest = f.destination || 'Trip';
        result.events.push(createEvent({
          ownerId, title: `Trip: ${dest}`, startAt: dep, endAt: ret ?? undefined, source: 'user',
        }));
        result.obligations.push(createObligation({
          ownerId, type: 'travel_requirement',
          title: `Prepare for trip: ${dest}`,
          detail: `Departure ${f.departure_date}${ret ? `, return ${f.return_date}` : ''}. PNR ${f.confirmation_code || 'n/a'}.`,
          dueAt: addDays(dep, -1), priority: 'high',
          actionPlan: 'Check passport validity (6+ months), visas, travel insurance, check-in and calendar conflicts.',
        }));
      }
      break;
    }

    case 'property': {
      const leaseEnd = iso(f.lease_end);
      if (leaseEnd) {
        result.obligations.push(createObligation({
          ownerId, type: 'notice',
          title: `Lease decision: ${f.property_address || title}`,
          detail: 'Lease ends soon — decide renewal/notice milestones.',
          dueAt: addDays(leaseEnd, -90), priority: 'medium',
        }));
      }
      if (num(f.monthly_rent) !== null) {
        result.obligations.push(createObligation({
          ownerId, type: 'payment',
          title: `Rent: ${f.property_address || title}`, detail: 'Monthly rent obligation.',
          dueAt: addDays(new Date(), 5), priority: 'high', recurrence: 'monthly',
        }));
      }
      break;
    }
  }

  audit(ownerId, 'record.manual_created', 'record', uuid(), { category, obligations: result.obligations.length });
  return result;
}
