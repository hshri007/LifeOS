/**
 * Obligation engine (§2.5 obligation model, §2.6 reminder logic).
 *
 * Derives structured records (assets, subscriptions, obligations, events) from
 * user-confirmed document fields, manages recurrence roll-forward and exposes
 * queries used by dashboard/assistant.
 */
import type {
  Asset, AssetType, Cadence, DocumentCategory, EventItem, Obligation,
  ObligationStatus, ObligationType, Priority, Provenance, Recurrence, Subscription,
} from '@lifeos/types';
import { db, parseJSON } from '../db';
import { addDays, addMonths, nowISO, uuid } from '../util';
import { fieldMap, listFields } from '../extraction/pipeline';

/** Default reminder schedules per obligation type (§2.6: configurable defaults). */
export const DEFAULT_REMINDER_POLICIES: Record<ObligationType, number[]> = {
  payment: [3, 0],
  renewal: [30, 7, 1],
  return_deadline: [3, 1, 0],
  warranty_claim: [7],
  service: [7, 1],
  appointment: [1],
  travel_requirement: [7, 1],
  notice: [14, 3],
};

export interface CreateObligationOpts {
  ownerId: string;
  type: ObligationType;
  title: string;
  detail?: string;
  dueAt: Date | string;
  recurrence?: Recurrence;
  priority?: Priority;
  reminderPolicy?: number[];
  assetId?: string | null;
  documentId?: string | null;
  provenance?: Provenance | null;
  actionPlan?: string;
}

const rowToObligation = (r: Record<string, unknown>): Obligation => ({
  id: String(r.id),
  owner_id: String(r.owner_id),
  asset_id: r.asset_id ? String(r.asset_id) : null,
  document_id: r.document_id ? String(r.document_id) : null,
  type: r.type as ObligationType,
  title: String(r.title),
  detail: r.detail ? String(r.detail) : null,
  due_at: String(r.due_at),
  recurrence: r.recurrence as Recurrence,
  status: r.status as ObligationStatus,
  priority: r.priority as Priority,
  reminder_policy: parseJSON<number[]>(r.reminder_policy, DEFAULT_REMINDER_POLICIES[r.type as ObligationType] ?? [7]),
  action_plan: r.action_plan ? String(r.action_plan) : null,
  provenance: parseJSON<Provenance | null>(r.provenance, null),
  snoozed_until: r.snoozed_until ? String(r.snoozed_until) : null,
  completed_at: r.completed_at ? String(r.completed_at) : null,
  created_at: String(r.created_at),
  updated_at: String(r.updated_at),
});

export function createObligation(o: CreateObligationOpts): Obligation {
  const id = uuid();
  const now = nowISO();
  const policy = o.reminderPolicy ?? DEFAULT_REMINDER_POLICIES[o.type];
  db.prepare(
    `INSERT INTO obligations (id, owner_id, asset_id, document_id, type, title, detail, due_at, recurrence, status, priority, reminder_policy, action_plan, provenance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`
  ).run(
    id, o.ownerId, o.assetId ?? null, o.documentId ?? null, o.type, o.title, o.detail ?? null,
    new Date(o.dueAt).toISOString(), o.recurrence ?? 'none', o.priority ?? 'medium',
    JSON.stringify(policy), o.actionPlan ?? null, o.provenance ? JSON.stringify(o.provenance) : null, now, now
  );
  return getObligation(o.ownerId, id)!;
}

export function getObligation(ownerId: string, id: string): Obligation | null {
  const r = db.prepare('SELECT * FROM obligations WHERE id = ? AND owner_id = ?').get(id, ownerId) as Record<string, unknown> | undefined;
  return r ? rowToObligation(r) : null;
}

export interface ObligationFilter {
  status?: ObligationStatus | 'all';
  withinDays?: number;
  type?: ObligationType;
  assetId?: string;
}

export function listObligations(ownerId: string, filter: ObligationFilter = {}): Array<Obligation & { overdue: boolean }> {
  let sql = 'SELECT * FROM obligations WHERE owner_id = ?';
  const params: unknown[] = [ownerId];
  if (filter.status && filter.status !== 'all') {
    sql += ' AND status = ?';
    params.push(filter.status);
  }
  if (filter.type) {
    sql += ' AND type = ?';
    params.push(filter.type);
  }
  if (filter.assetId) {
    sql += ' AND asset_id = ?';
    params.push(filter.assetId);
  }
  sql += ' ORDER BY due_at ASC';
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  let out = rows.map(rowToObligation);
  const now = new Date();
  out = out.map((o) => ({ ...o, overdue: o.status === 'open' && new Date(o.due_at) < now }));
  if (filter.withinDays !== undefined) {
    const horizon = addDays(now, filter.withinDays).toISOString();
    out = out.filter((o) => o.due_at <= horizon);
  }
  return out;
}

/**
 * Recurrence roll-forward (FR-008): completing a recurring obligation moves it
 * to the next occurrence instead of closing it.
 */
export function nextOccurrence(dueAt: string, recurrence: Recurrence): string {
  switch (recurrence) {
    case 'weekly': return addDays(dueAt, 7).toISOString();
    case 'monthly': return addMonths(dueAt, 1).toISOString();
    case 'quarterly': return addMonths(dueAt, 3).toISOString();
    case 'semiannual': return addMonths(dueAt, 6).toISOString();
    case 'annual': return addMonths(dueAt, 12).toISOString();
    default: return dueAt;
  }
}

export function updateObligationStatus(ownerId: string, id: string, patch: {
  status?: ObligationStatus;
  dueAt?: string;
  title?: string;
  detail?: string;
  priority?: Priority;
  snoozedUntil?: string | null;
}): Obligation | null {
  const existing = getObligation(ownerId, id);
  if (!existing) return null;

  // Recurring obligations roll forward on completion rather than closing.
  if (patch.status === 'completed' && existing.recurrence !== 'none') {
    const nextDue = nextOccurrence(existing.due_at, existing.recurrence);
    db.prepare('UPDATE obligations SET due_at = ?, status = ?, completed_at = NULL, updated_at = ? WHERE id = ?')
      .run(nextDue, 'open', nowISO(), id);
    return getObligation(ownerId, id);
  }

  const status = patch.status ?? existing.status;
  const completedAt = status === 'completed' ? nowISO() : null;
  db.prepare(
    `UPDATE obligations SET status = ?, due_at = COALESCE(?, due_at), title = COALESCE(?, title),
     detail = COALESCE(?, detail), priority = COALESCE(?, priority), snoozed_until = ?,
     completed_at = ?, updated_at = ? WHERE id = ?`
  ).run(
    status, patch.dueAt ?? null, patch.title ?? null, patch.detail ?? null, patch.priority ?? null,
    patch.snoozedUntil !== undefined ? patch.snoozedUntil : existing.snoozed_until,
    completedAt, nowISO(), id
  );
  return getObligation(ownerId, id);
}

/* ------------------------------------------------------------------ */
/* Assets / subscriptions / events helpers                             */
/* ------------------------------------------------------------------ */

export function createAsset(ownerId: string, type: AssetType, name: string, metadata: Record<string, unknown> = {}): Asset {
  const id = uuid();
  const createdAt = nowISO();
  db.prepare('INSERT INTO assets (id, owner_id, type, name, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, ownerId, type, name, JSON.stringify(metadata), createdAt);
  return { id, owner_id: ownerId, type, name, metadata, created_at: createdAt };
}

export function listAssets(ownerId: string): Asset[] {
  const rows = db.prepare('SELECT * FROM assets WHERE owner_id = ? ORDER BY created_at DESC').all(ownerId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    owner_id: String(r.owner_id),
    type: r.type as AssetType,
    name: String(r.name),
    metadata: parseJSON<Record<string, unknown>>(r.metadata, {}),
    created_at: String(r.created_at),
  }));
}

export function upsertSubscription(s: Omit<Subscription, 'id' | 'created_at'>): Subscription {
  const existing = db.prepare('SELECT * FROM subscriptions WHERE owner_id = ? AND merchant = ? AND status = ?')
    .get(s.owner_id, s.merchant, 'active') as Record<string, unknown> | undefined;
  if (existing) {
    db.prepare('UPDATE subscriptions SET amount=?, currency=?, cadence=?, renewal_at=?, category=? WHERE id=?')
      .run(s.amount, s.currency, s.cadence, s.renewal_at, s.category, String(existing.id));
    return {
      id: String(existing.id),
      owner_id: String(existing.owner_id),
      merchant: String(existing.merchant),
      amount: s.amount,
      currency: s.currency,
      cadence: s.cadence,
      renewal_at: s.renewal_at,
      category: s.category,
      status: 'active',
      document_id: s.document_id ?? null,
      created_at: String(existing.created_at),
    };
  }
  const id = uuid();
  const createdAt = nowISO();
  db.prepare('INSERT INTO subscriptions (id, owner_id, merchant, amount, currency, cadence, renewal_at, category, status, document_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, s.owner_id, s.merchant, s.amount, s.currency, s.cadence, s.renewal_at, s.category, s.status, s.document_id ?? null, createdAt);
  return { id, ...s, created_at: createdAt };
}

export function listSubscriptions(ownerId: string): Subscription[] {
  const rows = db.prepare("SELECT * FROM subscriptions WHERE owner_id = ? AND status = 'active' ORDER BY renewal_at").all(ownerId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    owner_id: String(r.owner_id),
    merchant: String(r.merchant),
    amount: Number(r.amount),
    currency: String(r.currency),
    cadence: r.cadence as Cadence,
    renewal_at: String(r.renewal_at),
    category: String(r.category),
    status: r.status as Subscription['status'],
    document_id: r.document_id ? String(r.document_id) : null,
    created_at: String(r.created_at),
  }));
}

export function monthlyCost(subs: Subscription[]): number {
  const factor: Record<Cadence, number> = { monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, annual: 1 / 12 };
  return subs.reduce((sum, s) => sum + s.amount * factor[s.cadence], 0);
}

export function createEvent(e: { ownerId: string; title: string; startAt: string; endAt?: string; location?: string; source?: EventItem['source'] }): EventItem {
  const id = uuid();
  const createdAt = nowISO();
  db.prepare('INSERT INTO events (id, owner_id, title, start_at, end_at, location, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, e.ownerId, e.title, e.startAt, e.endAt ?? null, e.location ?? null, e.source ?? 'user', createdAt);
  return { id, owner_id: e.ownerId, title: e.title, start_at: e.startAt, end_at: e.endAt ?? null, location: e.location ?? null, source: e.source ?? 'user', created_at: createdAt };
}

export function listEvents(ownerId: string): EventItem[] {
  const rows = db.prepare('SELECT * FROM events WHERE owner_id = ? ORDER BY start_at').all(ownerId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    owner_id: String(r.owner_id),
    title: String(r.title),
    start_at: String(r.start_at),
    end_at: r.end_at ? String(r.end_at) : null,
    location: r.location ? String(r.location) : null,
    source: r.source as EventItem['source'],
    created_at: String(r.created_at),
  }));
}

/* ------------------------------------------------------------------ */
/* Record derivation from confirmed documents (UC-001 … UC-008 etc.)   */
/* ------------------------------------------------------------------ */

const isoDate = (v: string | undefined): string | null =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : null;

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function provenanceFor(doc: { id: string; title: string }, spans: Array<[number, number]>): Provenance {
  return { documentId: doc.id, documentTitle: doc.title, spans };
}

/**
 * Turn confirmed extracted fields into structured records.
 * Implements UC-001 (invoice→warranty), UC-006 (vehicle insurance), UC-007 (PUC),
 * UC-008 (service), UC-004/005 (subscriptions), UC-012 (bills), UC-009 (travel),
 * UC-023/024 (property).
 */
export function deriveRecordsFromDocument(ownerId: string, documentId: string): {
  assets: Asset[];
  subscriptions: Subscription[];
  events: EventItem[];
  obligations: Obligation[];
} {
  const doc = getDocumentRow(documentId);
  if (!doc || doc.owner_id !== ownerId) throw new Error('Document not found');
  const fields = fieldMap(listFields(documentId).filter((f) => f.confirmed));
  const cat = doc.category as DocumentCategory;
  const prov = (spans: Array<[number, number]> = []): Provenance => provenanceFor(doc, spans);

  const result = { assets: [], subscriptions: [], events: [], obligations: [] } as ReturnType<typeof deriveRecordsFromDocument>;

  switch (cat) {
    case 'purchase_invoice': {
      const itemName = fields.get('item_name') ?? fields.get('merchant') ?? doc.title;
      const purchase = isoDate(fields.get('purchase_date'));
      const price = num(fields.get('price_amount')?.split(':').pop());
      const asset = createAsset(ownerId, 'electronics', itemName, {
        purchase_date: purchase, price_amount: price, order_id: fields.get('order_id'), merchant: fields.get('merchant'),
      });
      result.assets.push(asset);

      const windowDays = num(fields.get('return_window_days'));
      if (purchase && windowDays) {
        result.obligations.push(createObligation({
          ownerId, type: 'return_deadline', documentId: doc.id, assetId: asset.id,
          title: `Return window closes: ${itemName}`,
          detail: `Return accepted within ${windowDays} days of purchase.`,
          dueAt: addDays(purchase, windowDays), priority: 'high', provenance: prov(),
          actionPlan: 'Decide whether to keep the item; if returning, start the return with the merchant before this date.',
        }));
      }
      const warrantyMonths = num(fields.get('warranty_duration_months')) ?? 12;
      if (purchase) {
        result.obligations.push(createObligation({
          ownerId, type: 'notice', documentId: doc.id, assetId: asset.id,
          title: `Warranty ends: ${itemName}`,
          detail: `Manufacturer warranty of ${warrantyMonths} months from purchase. File any claim before this date.`,
          dueAt: addMonths(purchase, warrantyMonths), priority: 'medium', provenance: prov(),
          actionPlan: 'If the product fails before this date, gather the invoice and contact support.',
        }));
      }
      break;
    }

    case 'insurance': {
      const provider = fields.get('provider') ?? 'Insurer';
      const end = isoDate(fields.get('end_date'));
      const insured = fields.get('insured_name');
      if (end) {
        result.obligations.push(createObligation({
          ownerId, type: 'renewal', documentId: doc.id,
          title: `Insurance renewal: ${provider}${insured ? ` (${insured})` : ''}`,
          detail: `Policy ${fields.get('policy_number') ?? ''} expires on ${end.slice(0, 10)}. Renew before expiry to avoid a coverage gap.`,
          dueAt: end, priority: 'high', recurrence: 'annual', provenance: prov(),
          actionPlan: 'Compare renewal quotes, then renew with the insurer or an aggregator.',
        }));
      }
      break;
    }

    case 'vehicle': {
      const reg = fields.get('registration_number');
      const name = fields.get('make_model') ?? (reg ? `Vehicle ${reg}` : doc.title);
      let asset = listAssets(ownerId).find((a) => a.type === 'vehicle' && reg && a.metadata['registration_number'] === reg);
      if (!asset) {
        asset = createAsset(ownerId, 'vehicle', name, {
          registration_number: reg, make_model: fields.get('make_model'), odometer_km: num(fields.get('odometer_km')),
        });
        result.assets.push(asset);
      }
      const puc = isoDate(fields.get('puc_expiry'));
      if (puc) {
        result.obligations.push(createObligation({
          ownerId, type: 'renewal', documentId: doc.id, assetId: asset.id,
          title: `PUC renewal: ${name}`, detail: 'Pollution-under-control certificate expires.',
          dueAt: puc, priority: 'high', recurrence: 'semiannual', provenance: prov(),
        }));
      }
      const insExp = isoDate(fields.get('insurance_expiry'));
      if (insExp) {
        result.obligations.push(createObligation({
          ownerId, type: 'renewal', documentId: doc.id, assetId: asset.id,
          title: `Vehicle insurance renewal: ${name}`, detail: 'Third-party/comprehensive policy expires.',
          dueAt: insExp, priority: 'critical', recurrence: 'annual', provenance: prov(),
        }));
      }
      const svc = isoDate(fields.get('next_service_date'));
      if (svc) {
        result.obligations.push(createObligation({
          ownerId, type: 'service', documentId: doc.id, assetId: asset.id,
          title: `Service due: ${name}`, detail: 'Scheduled maintenance per service invoice.',
          dueAt: svc, priority: 'medium', provenance: prov(),
        }));
      }
      break;
    }

    case 'subscription': {
      const merchant = fields.get('merchant') ?? doc.title;
      const amountRaw = fields.get('amount');
      const amount = num(amountRaw?.split(':').pop()) ?? 0;
      const currency = amountRaw?.startsWith('USD') ? 'USD' : 'INR';
      const renewal = isoDate(fields.get('renewal_date')) ?? addDays(new Date(), 30).toISOString();
      const cadence = (fields.get('cadence') ?? 'monthly') as Cadence;
      const sub = upsertSubscription({
        owner_id: ownerId, merchant, amount, currency, cadence, renewal_at: renewal,
        category: 'general', status: 'active', document_id: doc.id,
      });
      result.subscriptions.push(sub);
      result.obligations.push(createObligation({
        ownerId, type: 'renewal', documentId: doc.id,
        title: `${merchant} renews (${cadence})`,
        detail: `Recurring charge ${currency} ${amount}. Cancel or manage before renewal if unwanted.`,
        dueAt: renewal, priority: 'low', recurrence: cadence === 'monthly' ? 'monthly' : cadence === 'quarterly' ? 'quarterly' : 'annual',
        provenance: prov(),
      }));
      break;
    }

    case 'bills': {
      const issuer = fields.get('issuer') ?? fields.get('bill_type') ?? 'Biller';
      const due = isoDate(fields.get('due_date'));
      const amt = num(fields.get('amount_due')?.split(':').pop()) ?? 0;
      const cur = (fields.get('amount_due') ?? '').startsWith('USD') ? 'USD' : 'INR';
      if (due) {
        result.obligations.push(createObligation({
          ownerId, type: 'payment', documentId: doc.id,
          title: `Pay ${issuer} bill`, detail: `Amount due ${cur} ${amt}. Account ${fields.get('account_number') ?? ''}.`,
          dueAt: due, priority: 'high', provenance: prov(),
          actionPlan: 'Pay via the issuer app/bank before the due date to avoid late fees.',
        }));
      }
      break;
    }

    case 'travel': {
      const dest = fields.get('destination') ?? 'Trip';
      const dep = isoDate(fields.get('departure_date'));
      const ret = isoDate(fields.get('return_date'));
      if (dep) {
        result.events.push(createEvent({
          ownerId, title: `Trip: ${dest}`, startAt: dep, endAt: ret ?? undefined,
          source: 'travel_doc',
        }));
        result.obligations.push(createObligation({
          ownerId, type: 'travel_requirement', documentId: doc.id,
          title: `Prepare for trip: ${dest}`,
          detail: `Departure ${dep.slice(0, 10)}${ret ? `, return ${ret.slice(0, 10)}` : ''}. PNR ${fields.get('confirmation_code') ?? 'n/a'}.`,
          dueAt: addDays(dep, -1), priority: 'high', provenance: prov(),
          actionPlan: 'Check passport validity (6+ months), visas, travel insurance, check-in and calendar conflicts.',
        }));
      }
      break;
    }

    case 'property': {
      const addr = fields.get('property_address') ?? doc.title;
      const leaseEnd = isoDate(fields.get('lease_end'));
      const rent = num(fields.get('monthly_rent')?.split(':').pop());
      if (leaseEnd) {
        result.obligations.push(createObligation({
          ownerId, type: 'notice', documentId: doc.id,
          title: `Lease decision: ${addr}`,
          detail: 'Lease ends soon — decide renewal/notice milestones.',
          dueAt: addDays(leaseEnd, -90), priority: 'medium', provenance: prov(),
        }));
      }
      if (rent !== null) {
        result.obligations.push(createObligation({
          ownerId, type: 'payment', documentId: doc.id,
          title: `Rent: ${addr}`, detail: `Monthly rent obligation.`,
          dueAt: addDays(new Date(), 5), priority: 'high', recurrence: 'monthly', provenance: prov(),
        }));
      }
      break;
    }

    case 'warranty': {
      const item = fields.get('covered_item') ?? doc.title;
      const end = isoDate(fields.get('end_date'));
      if (end) {
        result.obligations.push(createObligation({
          ownerId, type: 'notice', documentId: doc.id,
          title: `Warranty/AMC ends: ${item}`, detail: `Provider ${fields.get('provider') ?? 'n/a'}.`,
          dueAt: end, priority: 'medium', provenance: prov(),
        }));
      }
      break;
    }

    default:
      // 'other': no automatic derivation — user can create obligations manually.
      break;
  }

  db.prepare("UPDATE documents SET status = 'confirmed' WHERE id = ?").run(documentId);
  return result;
}

interface DocRow {
  id: string;
  owner_id: string;
  title: string;
  category: string;
}

function getDocumentRow(documentId: string): DocRow | undefined {
  return db.prepare('SELECT id, owner_id, title, category FROM documents WHERE id = ?').get(documentId) as DocRow | undefined;
}
