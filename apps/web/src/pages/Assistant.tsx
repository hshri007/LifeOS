import { useEffect, useRef, useState } from 'react';
import { api, type AssistantAnswerData } from '../api';

interface Msg {
  role: 'user' | 'bot';
  text: string;
  sources?: AssistantAnswerData['sources'];
}

const SUGGESTIONS = [
  'What needs my attention?',
  'What expires in the next 60 days?',
  'What subscriptions do I have?',
  'Show everything related to my car',
  'What do I need for my Dubai trip?',
  'Which warranties are still active?',
];

export default function Assistant() {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: 'bot',
      text:
        'I answer only from your LifeOS records — every fact links to its source document. ' +
        'I never take external actions without your explicit approval.',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs]);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setMsgs((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setBusy(true);
    try {
      const res = await api.get<AssistantAnswerData>(`/assistant?q=${encodeURIComponent(q)}`);
      setMsgs((m) => [...m, { role: 'bot', text: res.answer, sources: res.sources }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'bot', text: e instanceof Error ? e.message : 'Something went wrong.' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="page-title">Assistant</h1>
      <p className="page-sub">Grounded Q&A over your records (§5.2). Dates and amounts come from structured data — not guesses.</p>

      <div className="suggestions">
        {SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)}>{s}</button>)}
      </div>

      <div className="chat-box">
        <div className="chat-scroll" ref={scrollRef}>
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.text}
              {m.sources && m.sources.length > 0 && (
                <div className="sources">
                  {m.sources.map((s) => (
                    <span key={s.documentId} className="chip cat" title={`Source document: ${s.title}`}>
                      ▤ {s.title}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="msg bot muted">Thinking…</div>}
        </div>
        <form
          className="chat-input"
          onSubmit={(e) => { e.preventDefault(); ask(input); }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your obligations, documents, subscriptions…"
          />
          <button className="btn primary" disabled={busy || !input.trim()}>Ask</button>
        </form>
      </div>
    </>
  );
}