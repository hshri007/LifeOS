import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type DocumentRow } from '../api';

interface IngestResponse {
  document: DocumentRow;
  extraction: { category: string; warnings: string[]; fields: Array<{ field: string }> };
  duplicate: boolean;
}

export default function Documents() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setDocs((await api.get<{ documents: DocumentRow[] }>('/documents')).documents);
  }
  useEffect(() => { load(); }, []);

  async function ingest(payload: Record<string, unknown>) {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await api.post<IngestResponse>('/documents/upload', payload);
      if (res.duplicate) {
        setNotice('This document was already ingested — opening the existing record.');
      } else {
        setNotice(`Extracted ${res.extraction.fields.length} fields · classified as ${res.extraction.category}`);
      }
      setText(''); setTitle('');
      navigate(`/documents/${res.document.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const content = await f.text();
    ingest({ title: f.name.replace(/\.[^.]+$/, ''), text: content, source: 'upload' });
  }

  return (
    <>
      <h1 className="page-title">Documents</h1>
      <p className="page-sub">Upload or paste a document — LifeOS extracts what matters and turns it into reminders.</p>

      <div className="card section">
        <h3>Add a document</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input ref={fileRef} type="file" accept=".txt,.md,.csv,.json" onChange={onFile} disabled={busy} style={{ flex: 1 }} />
          <span className="muted">or paste below</span>
        </div>
        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Laptop invoice" />
        <label>Document text</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'Paste invoice / policy / bill text here…\n\nTip: include dates like "Due Date: 30 Aug 2026" and amounts like "Rs. 2,340.00".'} />
        <button
          className="btn primary"
          style={{ marginTop: 12 }}
          disabled={busy || text.trim().length < 10}
          onClick={() => ingest({ title: title || 'Pasted document', text, source: 'manual' })}
        >
          {busy ? 'Extracting…' : 'Extract & review'}
        </button>
        {error && <div className="error-box">{error}</div>}
        {notice && <div className="info-box">{notice}</div>}
      </div>

      <div className="card">
        <h3>On file ({docs.length})</h3>
        {docs.length === 0 && <div className="empty">No documents yet.</div>}
        {docs.map((d) => (
          <div key={d.id} className="doc-row" onClick={() => navigate(`/documents/${d.id}`)}>
            <div className="obl-main">
              <div className="doc-title">{d.title}</div>
              <div className="muted">added {new Date(d.created_at).toLocaleDateString()}</div>
            </div>
            <span className="chip cat">{d.category}</span>
            <span className={`chip ${d.status === 'confirmed' ? 'ok' : 'medium'}`}>{d.status}</span>
          </div>
        ))}
      </div>
    </>
  );
}