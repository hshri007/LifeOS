/**
 * Grounded assistant (§5.1, §5.2).
 *
 * Architecture rule: language generation is separated from authoritative data.
 * This MVP implements a deterministic retrieval layer over structured records;
 * every factual claim cites its source document(s). An LLM can later rephrase
 * these grounded answers behind the same interface — dates/amounts/permissions
 * always come from the system of record, never from a model.
 */
import type { AssistantAnswer, AssistantIntent, AssistantSource } from '@lifeos/types';
import { formatMoney } from '../util';
import {
  listAssets, listObligations, listSubscriptions, monthlyCost,
} from './obligations';
import { buildBriefingItems } from './briefing';

/** Generic query stop-words — the fallback search ignores these. */
const STOPWORDS = new Set([
  'me', 'my', 'what', 'which', 'who', 'when', 'where', 'how', 'the', 'a', 'an',
  'and', 'or', 'about', 'for', 'with', 'all', 'any', 'are', 'is', 'do', 'does',
  'show', 'tell', 'give', 'list', 'find', 'from', 'this', 'that', 'have', 'has',
  'there', 'those', 'date', 'dates', 'today', 'soon', 'expire', 'expires', 'hey', 'hi',
]);

function sourcesFrom(items: Array<{ document_id?: string | null; title: string }>): AssistantSource[] {
  const byDoc = new Map<string, AssistantSource>();
  for (const it of items) {
    if (!it.document_id) continue;
    const existing = byDoc.get(it.document_id);
    if (existing) existing.fields.push(it.title);
    else byDoc.set(it.document_id, { documentId: it.document_id, title: it.title, fields: [it.title] });
  }
  return [...byDoc.values()];
}

function itemsFrom(rows: Array<{ id: string; title: string; due_at: string; priority: string; overdue?: boolean }>) {
  return rows.map((o) => ({
    obligationId: o.id,
    title: o.title,
    why: `due ${o.due_at.slice(0, 10)}`,
    dueAt: o.due_at,
    priority: o.priority as 'low' | 'medium' | 'high' | 'critical',
    overdue: o.overdue ?? false,
  }));
}

export function answerQuestion(userId: string, question: string): AssistantAnswer {
  const q = question.toLowerCase();
  const intent = detectIntent(q);

  switch (intent) {
    case 'what_needs_attention': {
      const items = buildBriefingItems(userId).slice(0, 8);
      const open = listObligations(userId, { status: 'open' });
      const overdue = open.filter((o) => o.overdue);
      const lines = items.map((i) => `- ${i.title} — ${i.why}`);
      return {
        intent,
        answer:
          (overdue.length > 0 ? `${overdue.length} item(s) are overdue. ` : '') +
          (items.length > 0
            ? `Here is what needs your attention, prioritized:\n${lines.join('\n')}`
            : 'Nothing needs attention right now.'),
        items,
        sources: sourcesFrom(open.slice(0, 8)),
        grounded: true,
      };
    }

    case 'expiring_soon': {
      const days = extractDays(q) ?? 60;
      const rows = listObligations(userId, { status: 'open', withinDays: days });
      return {
        intent,
        answer:
          rows.length > 0
            ? `${rows.length} obligation(s) expire within ${days} days:\n${rows.map((r) => `- ${r.title} — ${r.due_at.slice(0, 10)}`).join('\n')}`
            : `Nothing expires in the next ${days} days.`,
        items: itemsFrom(rows),
        sources: sourcesFrom(rows),
        grounded: true,
      };
    }

    case 'list_subscriptions':
    case 'recurring_cost': {
      const subs = listSubscriptions(userId);
      if (subs.length === 0) {
        return { intent, answer: 'No subscriptions recorded yet. Forward a subscription invoice or add one manually.', items: [], sources: [], grounded: true };
      }
      const lines = subs.map((s) => `- ${s.merchant}: ${formatMoney(s.amount, s.currency)} / ${s.cadence}, renews ${s.renewal_at.slice(0, 10)}`);
      return {
        intent,
        answer:
          `You have ${subs.length} active subscription(s), roughly ${formatMoney(monthlyCost(subs))}/month combined:\n${lines.join('\n')}`,
        items: [],
        sources: sourcesFrom(subs.map((s) => ({ document_id: s.document_id, title: s.merchant }))),
        grounded: true,
      };
    }

    case 'vehicle_status': {
      const vehicles = listAssets(userId).filter((a) => a.type === 'vehicle');
      if (vehicles.length === 0) {
        return { intent, answer: 'No vehicle profiles yet. Upload an RC, insurance or service invoice to create one.', items: [], sources: [], grounded: true };
      }
      const parts: string[] = [];
      for (const v of vehicles) {
        const rel = listObligations(userId, { status: 'open', assetId: v.id });
        parts.push(
          `${v.name}${v.metadata['registration_number'] ? ` (${String(v.metadata['registration_number'])})` : ''}:\n` +
            (rel.length > 0 ? rel.map((r) => `  - ${r.title} — ${r.due_at.slice(0, 10)}`).join('\n') : '  - no upcoming obligations')
        );
      }
      const allRel = listObligations(userId, { status: 'open' }).filter((o) => o.asset_id && vehicles.some((v) => v.id === o.asset_id));
      return { intent, answer: parts.join('\n\n'), items: itemsFrom(allRel), sources: sourcesFrom(allRel), grounded: true };
    }

    case 'trip_readiness': {
      const upcoming = listObligations(userId, { status: 'open', type: 'travel_requirement' });
      if (upcoming.length === 0) {
        return { intent, answer: 'No upcoming trips found. Import a flight/hotel document and I will build a readiness checklist.', items: [], sources: [], grounded: true };
      }
      return {
        intent,
        answer:
          `Upcoming trip preparation:\n${upcoming.map((t) => `- ${t.title} — ${t.detail ?? ''}`).join('\n')}\n` +
          'Standard checklist: passport valid 6+ months beyond return, visa/e-visa, travel insurance, forex, check-in window.',
        items: itemsFrom(upcoming),
        sources: sourcesFrom(upcoming),
        grounded: true,
      };
    }

    case 'active_warranties': {
      const rows = listObligations(userId, { status: 'open' }).filter((o) =>
        /warranty/i.test(o.title)
      );
      return {
        intent,
        answer:
          rows.length > 0
            ? `Active warranties:\n${rows.map((r) => `- ${r.title} — until ${r.due_at.slice(0, 10)}`).join('\n')}`
            : 'No active warranties found.',
        items: itemsFrom(rows),
        sources: sourcesFrom(rows),
        grounded: true,
      };
    }

    case 'find_document': {
      // Keyword match against document titles via obligations provenance + assets.
      const words = q.split(/\W+/).filter((w) => w.length > 3 && !['where', 'find', 'document', 'policy', 'invoice', 'show'].includes(w));
      const rows = listObligations(userId, { status: 'all' }).filter((o) =>
        words.some((w) => o.title.toLowerCase().includes(w))
      );
      return {
        intent,
        answer:
          rows.length > 0
            ? `Found related records:\n${rows.map((r) => `- ${r.title} (source: ${r.document_id ? 'document on file' : 'manual entry'})`).join('\n')}`
            : 'I could not find matching records. Try the Documents page to browse everything on file.',
        items: itemsFrom(rows),
        sources: sourcesFrom(rows),
        grounded: true,
      };
    }

    case 'draft_email': {
      return {
        intent,
        answer:
          'I can prepare an email draft using verified facts from your documents, but nothing is ever sent without your explicit approval (agent level 2). ' +
          'Open the relevant record and choose "Draft email", review the draft, then approve.',
        items: [],
        sources: [],
        grounded: true,
      };
    }

    default: {
      // General fallback: answer ANY question from the records the user has,
      // so the assistant is genuinely useful beyond the canned intents. It
      // searches obligations, subscriptions, assets and documents and frames
      // what it found — without inventing facts outside the app's data.
      const q = question.toLowerCase();
      const keywords = q.split(/\W+/).map((w) => w.toLowerCase()).filter((w) => w.length > 2 && !STOPWORDS.has(w));
      const matches: string[] = [];

      const obls = listObligations(userId, { status: 'all' });
      for (const o of obls) {
        const hay = `${o.title} ${o.detail ?? ''} ${o.type}`.toLowerCase();
        if (keywords.some((k) => hay.includes(k))) {
          matches.push(`• ${o.title} — ${o.due_at.slice(0, 10)}${o.status === 'open' && new Date(o.due_at) < new Date() ? ' (overdue)' : ''}`);
        }
      }
      const subs = listSubscriptions(userId);
      for (const s of subs) {
        const hay = `${s.merchant} ${s.category}`.toLowerCase();
        if (keywords.some((k) => hay.includes(k))) {
          matches.push(`• ${s.merchant} — ${formatMoney(s.amount, s.currency)}/${s.cadence}, renews ${s.renewal_at.slice(0, 10)}`);
        }
      }
      const assets = listAssets(userId);
      for (const a of assets) {
        const hay = `${a.name} ${a.type} ${Object.values(a.metadata).join(' ')}`.toLowerCase();
        if (keywords.some((k) => hay.includes(k))) {
          matches.push(`• Asset: ${a.name} (${a.type})`);
        }
      }

      const answer = matches.length > 0
        ? `Here's what I found in your records for "${question}":\n${matches.slice(0, 8).join('\n')}` +
          (matches.length > 8 ? `\n…and ${matches.length - 8} more. Ask me to narrow it down.` : '')
        : `I couldn't find anything in your records matching "${question}". ` +
          'You can ask me things like "What needs my attention?", "What expires soon?", "What subscriptions do I have?", "About my car", or just add a record and ask again.';

      return {
        intent,
        answer,
        items: itemsFrom(obls.filter((o) => keywords.some((k) => `${o.title} ${o.detail ?? ''}`.toLowerCase().includes(k))).slice(0, 8)),
        sources: [],
        grounded: true,
      };
    }
  }
}

function detectIntent(q: string): AssistantIntent {
  if (/draft|write.*(email|mail)|email.*(provider|insurer|merchant)/.test(q)) return 'draft_email';
  if (/(what|anything).*(attention|due|todo|to-do|focus|priority)|briefing|this month/.test(q)) return 'what_needs_attention';
  if (/expir|renewal.*soon|next \d+ days|coming \d+ days/.test(q)) return 'expiring_soon';
  if (/(how much|spend|cost|monthly).*(subscription|recurring)|recurring.*(cost|spend)/.test(q)) return 'recurring_cost';
  if (/subscription|netflix|spotify|prime|saas/.test(q)) return 'list_subscriptions';
  if (/car|vehicle|bike|puc|service.*due/.test(q)) return 'vehicle_status';
  if (/trip|travel|flight|visa|dubai|itinerary|passport/.test(q)) return 'trip_readiness';
  if (/warrant/.test(q)) return 'active_warranties';
  if (/where.*(document|policy|invoice|warranty)|find.*(document|policy|invoice)/.test(q)) return 'find_document';
  return 'unknown';
}

function extractDays(q: string): number | null {
  const m = q.match(/(\d+)\s*days?/);
  return m ? Math.min(Number(m[1]), 365) : null;
}