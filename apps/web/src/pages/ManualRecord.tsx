import { useState } from 'react';
import { api, toast, type ManualResult } from '../api';

/** Manually add record details without uploading a document (e.g. a PUC expiry). */

const CATEGORY_FIELDS: Record<string, { label: string; key: string; type?: string }[]> = {
  vehicle: [
    { label: 'Make & model', key: 'make_model' },
    { label: 'Registration number', key: 'registration_number' },
    { label: 'PUC expiry', key: 'puc_expiry', type: 'date' },
    { label: 'Insurance expiry', key: 'insurance_expiry', type: 'date' },
    { label: 'Next service date', key: 'next_service_date', type: 'date' },
    { label: 'Odometer (km)', key: 'odometer_km' },
  ],
  insurance: [
    { label: 'Provider / Insurer', key: 'provider' },
    { label: 'Policy number', key: 'policy_number' },
    { label: 'End date', key: 'end_date', type: 'date' },
  ],
  subscription: [
    { label: 'Merchant', key: 'merchant' },
    { label: 'Amount', key: 'amount' },
    { label: 'Cadence (monthly/yearly)', key: 'cadence' },
    { label: 'Renewal date', key: 'renewal_date', type: 'date' },
  ],
  bills: [
    { label: 'Issuer', key: 'issuer' },
    { label: 'Amount due', key: 'amount_due' },
    { label: 'Due date', key: 'due_date', type: 'date' },
  ],
  purchase_invoice: [
    { label: 'Item / product', key: 'item_name' },
    { label: 'Merchant', key: 'merchant' },
    { label: 'Purchase date', key: 'purchase_date', type: 'date' },
    { label: 'Price amount', key: 'price_amount' },
    { label: 'Return window (days)', key: 'return_window_days' },
    { label: 'Warranty (months)', key: 'warranty_duration_months' },
  ],
  warranty: [
    { label: 'Covered item', key: 'covered_item' },
    { label: 'Provider', key: 'provider' },
    { label: 'End date', key: 'end_date', type: 'date' },
  ],
  travel: [
    { label: 'Destination', key: 'destination' },
    { label: 'Departure date', key: 'departure_date', type: 'date' },
    { label: 'Return date', key: 'return_date', type: 'date' },
    { label: 'PNR / confirmation', key: 'confirmation_code' },
  ],
  property: [
    { label: 'Property address', key: 'property_address' },
    { label: 'Monthly rent', key: 'monthly_rent' },
    { label: 'Lease end', key: 'lease_end', type: 'date' },
  ],
};

const CATEGORY_LABEL: Record<string, string> = {
  vehicle: 'Vehicle', insurance: 'Insurance', subscription: 'Subscription', bills: 'Bill',
  purchase_invoice: 'Purchase invoice', warranty: 'Warranty / AMC', travel: 'Trip', property: 'Property',
};

type Recurrence = 'none' | 'weekly' | 'monthly' | 'annual';

export default function ManualRecord() {
  const [category, setCategory] = useState('vehicle');
  const [title, setTitle] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [recurrence, setRecurrence] = useState<Recurrence>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ManualResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await api.post<ManualResult>('/records/manual', {
        category, title, fields: values, recurrence: recurrence === 'none' ? undefined : recurrence,
      });
      setResult(res);
      toast(`Created ${res.obligations.length} reminder(s)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  const fields = CATEGORY_FIELDS[category] ?? [];

  return (
    <>
      <h1 className="page-title">Add a record</h1>
      <p className="page-sub">No document handy? Type the details directly — LifeOS creates the reminders for you (e.g. a PUC or insurance expiry). Pick a recurrence so the reminder repeats automatically.</p>

      <div className="card section">
        <h3>What is it?</h3>
        <div className="chip-row">
          {Object.keys(CATEGORY_FIELDS).map((c) => (
            <button key={c} className={`chip-btn ${category === c ? 'active' : ''}`}
              onClick={() => { setCategory(c); setValues({}); setResult(null); }}>
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      <form className="card" onSubmit={submit}>
        <label>Title (optional)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`e.g. My ${CATEGORY_LABEL[category].toLowerCase()}`} />

        <div className="grid cols-2">
          {fields.map((f) => (
            <label key={f.key} className="manual-field">
              {f.label}
              <input
                type={f.type ?? 'text'}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="grid cols-2">
          <div>
            <label>Recurrence</label>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
              <option value="none">One time</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Creating…' : 'Create reminders →'}
            </button>
          </div>
        </div>
      </form>

      {result && (
        <div className="card section">
          <h3>✓ Created</h3>
          {result.obligations.map((o, i) => <div key={`o${i}`} className="obl-row"><div className="obl-main"><div className="obl-title">{o.title}</div></div><span className="chip medium">due {o.due_at.slice(0, 10)}</span></div>)}
          {result.assets.map((a, i) => <div key={`a${i}`} className="obl-row"><div className="obl-main"><div className="obl-title">Asset: {a.name}</div></div><span className="chip cat">{a.type}</span></div>)}
          {result.subscriptions.map((s, i) => <div key={`s${i}`} className="obl-row"><div className="obl-main"><div className="obl-title">Subscription: {s.merchant}</div></div></div>)}
          {result.obligations.length === 0 && result.assets.length === 0 && result.subscriptions.length === 0 && <div className="muted">Nothing created — add at least one field.</div>}
        </div>
      )}
    </>
  );
}
