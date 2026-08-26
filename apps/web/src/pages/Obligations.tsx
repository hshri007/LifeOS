import { useEffect, useState } from 'react';
import { api, type ObligationRow } from '../api';

type Tab = 'open' | 'all';

export default function Obligations() {
  const [tab, setTab] = useState<Tab>('open');
  const [rows, setRows] = useState<ObligationRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', type: 'notice', due_at: '', priority: 'medium', recurrence: 'none', detail: '' });

  async function load() {
    try {
      setRows((await api.get<{ obligations: ObligationRow[] }>(`/obligations?status=${tab}`)).obligations);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); }, [tab]);

  async function act(id: string, action: string) {
    await api.patch(`/obligations/${id}`, { action });
    load();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/obligations', {
        title: form.title,
        type: form.type,
        priority: form.priority,
        recurrence: form.recurrence,
        detail: form.detail || undefined,
        due_at: new Date(form.due_at).toISOString(),
      });
      setShowForm(false);
      setForm({ title: '', type: 'notice', due_at: '', priority: 'medium', recurrence: 'none', detail: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <>
      <h1 className="page-title">Obligations</h1>
      <p className="page-sub">Every deadline LifeOS is tracking for you. Past-due items stay visible until resolved.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn ${tab === 'open' ? 'primary' : ''}`} onClick={() => setTab('open')}>Open</button>
        <button className={`btn ${tab === 'all' ? 'primary' : ''}`} onClick={() => setTab('all')}>All</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New obligation'}</button>
      </div>

      {showForm && (
        <form className="card section" onSubmit={create}>
          <h3>New obligation</h3>
          <label>Title</label>
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <div className="grid cols-3">
            <div>
              <label>Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {['payment', 'renewal', 'return_deadline', 'warranty_claim', 'service', 'appointment', 'travel_requirement', 'notice'].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label>Due date</label>
              <input required type="date" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} />
            </div>
            <div>
              <label>Priority</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {['low', 'medium', 'high', 'critical'].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <label>Recurrence</label>
          <select value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })}>
            {['none', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual'].map((r) => <option key={r}>{r}</option>)}
          </select>
          <label>Detail (optional)</label>
          <input value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
          <button className="btn primary" style={{ marginTop: 14 }}>Create</button>
        </form>
      )}

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        {rows.length === 0 && <div className="empty">Nothing here.</div>}
        {rows.map((o) => (
          <div key={o.id} className={`obl-row ${o.overdue ? 'overdue' : ''}`}>
            <div className="obl-main">
              <div className="obl-title">{o.title}</div>
              {o.detail && <div className="obl-detail">{o.detail}</div>}
            </div>
            <span className="chip cat">{o.type}</span>
            <span className={`chip ${o.priority}`}>{o.priority}</span>
            {o.recurrence !== 'none' && <span className="chip cat">↻ {o.recurrence}</span>}
            <span className="obl-due">{new Date(o.due_at).toLocaleDateString()}</span>
            {o.status === 'open' || o.status === 'snoozed' ? (
              <>
                <button className="btn small" onClick={() => act(o.id, 'complete')} title="Complete">✓</button>
                <button className="btn small" onClick={() => act(o.id, 'snooze')} title="Snooze 3 days">⏾</button>
                <button className="btn small" onClick={() => act(o.id, 'dismiss')} title="Dismiss">✕</button>
              </>
            ) : (
              <>
                <span className="chip ok">{o.status}</span>
                {(o.status === 'completed' || o.status === 'dismissed') && (
                  <button className="btn small" onClick={() => act(o.id, 'reopen')} title="Reopen">↺</button>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}