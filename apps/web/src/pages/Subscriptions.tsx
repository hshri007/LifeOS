import { useEffect, useState } from 'react';
import { api, type DashboardData } from '../api';

export default function Subscriptions() {
  const [data, setData] = useState<DashboardData['money'] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<DashboardData>('/dashboard')
      .then((d) => setData(d.money))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <div className="empty">Loading…</div>;

  const fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: data.currency, maximumFractionDigits: 0 });

  return (
    <>
      <h1 className="page-title">Subscriptions</h1>
      <p className="page-sub">What recurs in your life — and what it costs. Cancellation suggestions are framed as suggestions, never judgments.</p>
      <div className="card">
        <h3>Active ({data.subscriptions.length})</h3>
        <div className="money-big">{fmt.format(data.monthlyRecurringEstimate)}<span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>/mo estimated</span></div>
        <table className="data" style={{ marginTop: 14 }}>
          <thead><tr><th>Merchant</th><th>Amount</th><th>Cadence</th><th>Renews</th></tr></thead>
          <tbody>
            {data.subscriptions.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.merchant}</strong></td>
                <td>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: s.currency }).format(s.amount)}</td>
                <td><span className="chip cat">{s.cadence}</span></td>
                <td>{s.renewal_at.slice(0, 10)}</td>
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