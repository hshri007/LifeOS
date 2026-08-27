import { useEffect, useState } from 'react';
import { api, toast, type DashboardData } from '../api';

export default function Subscriptions() {
  const [data, setData] = useState<DashboardData['money'] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<{ amount: string; cadence: string; renewal_at: string }>({
    amount: '', cadence: 'monthly', renewal_at: '',
  });

  async function load() {
    try {
      const d = await api.get<DashboardData>('/dashboard');
      setData(d.money);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <div className="empty">Loading…</div>;

  const fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: data.currency, maximumFractionDigits: 0 });

  async function remove(id: string, merchant: string) {
    if (!window.confirm(`Cancel "${merchant}"? It'll stop renewing and its reminder is removed.`)) return;
    await api.del(`/subscriptions/${id}`);
    toast('Subscription cancelled');
    load();
  }

  function startEdit(s: { id: string; amount: number; cadence: string; renewal_at: string }) {
    setEditing(s.id);
    setForm({ amount: String(s.amount), cadence: s.cadence, renewal_at: s.renewal_at.slice(0, 10) });
  }

  async function saveEdit(id: string) {
    await api.patch(`/subscriptions/${id}`, {
      amount: Number(form.amount),
      cadence: form.cadence as 'monthly' | 'annual',
      renewal_at: new Date(form.renewal_at).toISOString(),
    });
    toast('Subscription updated');
    setEditing(null);
    load();
  }

  return (
    <>
      <h1 className="page-title">Subscriptions</h1>
      <p className="page-sub">What recurs in your life — and what it costs. Cancellation suggestions are framed as suggestions, never judgments.</p>
      <div className="card">
        <h3>Active ({data.subscriptions.length})</h3>
        <div className="money-big">{fmt.format(data.monthlyRecurringEstimate)}<span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>/mo estimated</span></div>
        <table className="data" style={{ marginTop: 14 }}>
          <thead><tr><th>Merchant</th><th>Amount</th><th>Cadence</th><th>Renews</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
          <tbody>
            {data.subscriptions.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.merchant}</strong></td>
                {editing === s.id ? (
                  <>
                    <td><input type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={{ width: 80 }} /></td>
                    <td>
                      <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })}>
                        <option value="monthly">monthly</option>
                        <option value="annual">annual</option>
                      </select>
                    </td>
                    <td><input type="date" value={form.renewal_at} onChange={(e) => setForm({ ...form, renewal_at: e.target.value })} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn small" onClick={() => saveEdit(s.id)}>✓ Save</button>
                      <button className="btn small" onClick={() => setEditing(null)}>✕ Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: s.currency }).format(s.amount)}</td>
                    <td><span className="chip cat">{s.cadence}</span></td>
                    <td>{s.renewal_at.slice(0, 10)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn small" onClick={() => startEdit(s)}>✎ Edit</button>
                      <button className="btn small danger" onClick={() => remove(s.id, s.merchant)}>🗑 Delete</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {data.subscriptions.length === 0 && (
          <div className="empty">No subscriptions yet — forward a subscription invoice via email ingestion or paste it in Documents.</div>
        )}
      </div>
    </>
  );
}
