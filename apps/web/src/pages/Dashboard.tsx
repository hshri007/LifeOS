import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type DashboardData, type ObligationRow } from '../api';

function dueLabel(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days > 1) return `due in ${days}d`;
  return days === -1 ? '1 day overdue' : `${-days} days overdue`;
}

function OblRow({ o, onDone }: { o: ObligationRow; onDone?: (id: string) => void }) {
  return (
    <div className={`obl-row ${o.overdue ? 'overdue' : ''}`}>
      <div className="obl-main">
        <div className="obl-title">{o.title}</div>
        {o.detail && <div className="obl-detail">{o.detail}</div>}
      </div>
      <span className={`chip ${o.priority}`}>{o.priority}</span>
      <span className="obl-due">{dueLabel(o.due_at)}</span>
      {onDone && <button className="btn small" onClick={() => onDone(o.id)} title="Mark done">✓</button>}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      setData(await api.get<DashboardData>('/dashboard'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); }, []);

  async function complete(id: string) {
    await api.patch(`/obligations/${id}`, { action: 'complete' });
    load();
  }

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <div className="empty">Loading your briefing…</div>;

  const fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: data.money.currency, maximumFractionDigits: 0 });
  const dueToday = data.today.length;
  const dueWeek = data.thisWeek.length;
  const attention = Math.max(dueToday, countOpen(data));

  return (
    <>
      <h1 className="page-title">Good to see you.</h1>
      <p className="page-sub">Here is what matters right now — and why.</p>
      <div className="dash-actions">
        <Link to="/records" className="btn primary">＋ Add record</Link>
        <Link to="/documents" className="btn">▤ Upload document</Link>
      </div>

      <div className="stat-grid">
        <div className="stat-tile accent">
          <div className="stat-label">Needs attention</div>
          <div className="stat-value">{attention}</div>
          <div className="stat-caption">{dueToday > 0 ? `${dueToday} due today` : 'All clear today'}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">This week</div>
          <div className="stat-value">{dueWeek}</div>
          <div className="stat-caption">upcoming deadlines</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Recurring / mo</div>
          <div className="stat-value">{fmt.format(data.money.monthlyRecurringEstimate)}</div>
          <div className="stat-caption">{data.money.subscriptions.length} subscriptions</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Assets tracked</div>
          <div className="stat-value">{data.assets.length}</div>
          <div className="stat-caption">vehicles · devices · more</div>
        </div>
      </div>
<section className="section">
        <div className="card briefing">
          <h3>AI Briefing</h3>
          <div className="briefing-summary">{data.briefing.summary}</div>
          {data.briefing.items.slice(0, 5).map((i) => (
            <div key={i.obligationId} className="brief-item">
              <span>{i.title}</span>
              <span className="why">{i.why}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid cols-3 section">
        <div className="card">
          <h3>Today</h3>
          {data.today.length === 0 && <div className="muted">Nothing due today.</div>}
          {data.today.map((o) => <OblRow key={o.id} o={o} onDone={complete} />)}
        </div>
        <div className="card">
          <h3>This week</h3>
          {data.thisWeek.length === 0 && <div className="muted">Clear for the week.</div>}
          {data.thisWeek.map((o) => <OblRow key={o.id} o={o} onDone={complete} />)}
        </div>
        <div className="card">
          <h3>This month</h3>
          {data.thisMonth.length === 0 && <div className="muted">Nothing else this month.</div>}
          {data.thisMonth.map((o) => <OblRow key={o.id} o={o} onDone={complete} />)}
        </div>
      </div>

      <div className="grid cols-2 section">
        <div className="card">
          <h3>Money — recurring</h3>
          <div className="money-big">{fmt.format(data.money.monthlyRecurringEstimate)}<span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>/mo estimated</span></div>
          <div style={{ marginTop: 10 }}>
            {data.money.subscriptions.map((s) => (
              <div key={s.id} className="obl-row">
                <div className="obl-main"><div className="obl-title">{s.merchant}</div></div>
                <span className="chip cat">{s.cadence}</span>
                <span className="obl-due">renews {s.renewal_at.slice(0, 10)}</span>
              </div>
            ))}
            {data.money.subscriptions.length === 0 && <div className="muted">No subscriptions tracked yet.</div>}
          </div>
        </div>
        <div className="card">
          <h3>Documents expiring soon</h3>
          {data.documents.expiringSoon.length === 0 && <div className="muted">Nothing expiring in the next 60 days.</div>}
          {data.documents.expiringSoon.map((d) => (
            <div key={`${d.documentId}-${d.title}`} className="obl-row">
              <div className="obl-main">
                <Link to={`/documents/${d.documentId}`} className="doc-title" style={{ textDecoration: 'none' }}>{d.title}</Link>
              </div>
              <span className="chip high">{d.expiryLabel}</span>
            </div>
          ))}
        </div>
      </div>

      <section className="section">
        <div className="card">
          <h3>Your assets</h3>
          <div className="grid cols-3">
            {data.assets.map((a) => (
              <div key={a.id}>
                <strong>{a.name}</strong>
                <div className="muted">{a.type}{a.metadata['registration_number'] ? ` · ${String(a.metadata['registration_number'])}` : ''}</div>
              </div>
            ))}
            {data.assets.length === 0 && <div className="muted">Add a record or upload a document to create your first asset.</div>}
          </div>
        </div>
      </section>
    </>
  );
}

function countOpen(data: DashboardData): number {
  return data.today.length + data.thisWeek.length + data.thisMonth.length;
}