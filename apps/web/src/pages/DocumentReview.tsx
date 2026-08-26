import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type DocumentRow, type FieldRow } from '../api';

interface Detail {
  document: DocumentRow;
  fields: FieldRow[];
  provenanceExcerpts: Array<{ fieldId: string; field: string; excerpt: string }>;
}

interface DerivedResponse {
  ok: boolean;
  derived: {
    assets: Array<{ name: string }>;
    subscriptions: Array<{ merchant: string }>;
    events: Array<{ title: string }>;
    obligations: Array<{ title: string; due_at: string }>;
  };
}

export default function DocumentReview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [derived, setDerived] = useState<DerivedResponse['derived'] | null>(null);

  async function load() {
    if (!id) return;
    try {
      setDetail(await api.get<Detail>(`/documents/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function saveField(f: FieldRow) {
    const value = edits[f.id];
    if (value === undefined || value === f.value) return;
    await api.patch(`/documents/${id}/fields/${f.id}`, { value });
    load();
  }

  async function confirmAll() {
    if (!detail || !id) return;
    // §5.5 guardrail: confirmation is explicit; deletion/derivation is audited.
    if (!window.confirm('Confirm these details? LifeOS will create reminders and records from them.')) return;
    setBusy(true); setError('');
    try {
      const payload = {
        fields: detail.fields.map((f) => ({ field: f.field, value: edits[f.id] ?? f.value })),
        createRecords: true,
      };
      const res = await api.post<DerivedResponse>(`/documents/${id}/confirm`, payload);
      setDerived(res.derived);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirm failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeDoc() {
    if (!id || !window.confirm('Delete this document and its extracted fields? Linked records remain.')) return;
    await api.del(`/documents/${id}`);
    navigate('/documents');
  }

  if (error && !detail) return <div className="error-box">{error}</div>;
  if (!detail) return <div className="empty">Loading…</div>;

  const confirmed = detail.document.status === 'confirmed';
  const excerptFor = (f: FieldRow): string =>
    detail.provenanceExcerpts.find((p) => p.fieldId === f.id)?.excerpt ?? '';

  return (
    <>
      <h1 className="page-title">{detail.document.title}</h1>
      <p className="page-sub">
        <span className="chip cat">{detail.document.category}</span>{' '}
        <span className={`chip ${confirmed ? 'ok' : 'medium'}`}>{detail.document.status}</span>
        {' '}· source: {detail.document.source}
      </p>

      {confirmed && (
        <div className="info-box">
          This document has been confirmed. Records were created from the verified fields below.
        </div>
      )}

      <div className="card section">
        <h3>Extracted fields — correct anything that looks wrong</h3>
        {detail.fields.length === 0 && <div className="empty">No fields could be extracted from this text.</div>}
        <table className="field-table">
          <tbody>
            {detail.fields.map((f) => (
              <tr key={f.id}>
                <td className="field-name">
                  {f.field}
                  {f.requires_confirmation && <span className="muted" title="High-impact field — needs your confirmation"> ⚑</span>}
                </td>
                <td style={{ width: 260 }}>
                  <input
                    defaultValue={f.value}
                    onChange={(e) => setEdits((s) => ({ ...s, [f.id]: e.target.value }))}
                    onBlur={() => saveField(f)}
                    disabled={confirmed}
                  />
                  {f.normalized_value && f.normalized_value !== f.value && (
                    <div className="muted">normalized: <code className="mono">{f.normalized_value}</code></div>
                  )}
                  <div className="excerpt" title="Provenance: exact source span in the original document (FR-005)">
                    “{excerptFor(f)}”
                  </div>
                </td>
                <td style={{ width: 90 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="confidence-bar"><div style={{ width: `${Math.round(f.confidence * 100)}%` }} /></div>
                    <span className="muted">{Math.round(f.confidence * 100)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!confirmed && detail.fields.length > 0 && (
          <button className="btn primary" style={{ marginTop: 14 }} onClick={confirmAll} disabled={busy}>
            {busy ? 'Creating records…' : '✓ Confirm & create reminders'}
          </button>
        )}
        {error && <div className="error-box">{error}</div>}
      </div>

      {derived && (
        <div className="card section">
          <h3>Created from this document</h3>
          {derived.assets.map((a, i) => <div key={`a${i}`} className="obl-row"><div className="obl-main"><div className="obl-title">Asset: {a.name}</div></div></div>)}
          {derived.subscriptions.map((s, i) => <div key={`s${i}`} className="obl-row"><div className="obl-main"><div className="obl-title">Subscription: {s.merchant}</div></div></div>)}
          {derived.events.map((ev, i) => <div key={`e${i}`} className="obl-row"><div className="obl-main"><div className="obl-title">Event: {ev.title}</div></div></div>)}
          {derived.obligations.map((o, i) => (
            <div key={`o${i}`} className="obl-row">
              <div className="obl-main"><div className="obl-title">{o.title}</div></div>
              <span className="chip medium">due {o.due_at.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}

      <button className="btn danger" onClick={removeDoc}>Delete document</button>
    </>
  );
}