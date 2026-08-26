/**
 * Personal briefing (§5.3): prioritizes by impact and time — not a raw date sort.
 * Overdue first, then critical/high priorities, then nearest deadlines.
 */
import type { BriefingItem, DashboardResponse, Obligation, Priority } from '@lifeos/types';
import { addDays, daysBetween } from '../util';
import { listAssets, listObligations, listSubscriptions, monthlyCost } from './obligations';

const PRIORITY_WEIGHT: Record<Priority, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function buildBriefingItems(ownerId: string): BriefingItem[] {
  const open = listObligations(ownerId, { status: 'open' });
  const now = new Date();
  return open
    .map((o) => {
      const diff = daysBetween(now, o.due_at);
      let why: string;
      if (diff < 0) why = `Overdue by ${-diff} day${diff === -1 ? '' : 's'}`;
      else if (diff === 0) why = 'Due today';
      else if (diff <= 7) why = `Due in ${diff} day${diff === 1 ? '' : 's'}`;
      else why = `Due ${o.due_at.slice(0, 10)} (${diff} days away)`;
      if (o.priority === 'critical') why += ' · critical priority';
      return {
        obligationId: o.id,
        title: o.title,
        why,
        dueAt: o.due_at,
        priority: o.priority,
        overdue: diff < 0,
      };
    })
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      const pw = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      if (pw !== 0) return pw;
      return a.dueAt.localeCompare(b.dueAt);
    });
}

export function buildBriefingSummary(items: BriefingItem[]): string {
  if (items.length === 0) {
    return 'You are all clear — no open obligations. Add a document to get started.';
  }
  const overdue = items.filter((i) => i.overdue);
  const soon = items.filter((i) => !i.overdue).slice(0, 3);
  const parts: string[] = [];
  if (overdue.length > 0) {
    parts.push(`${overdue.length} item${overdue.length === 1 ? ' is' : 's are'} overdue, starting with "${overdue[0].title}"`);
  }
  if (soon.length > 0) {
    parts.push(`next up: ${soon.map((s) => `"${s.title}" (${s.why})`).join(', ')}`);
  }
  return `${parts.join('. ')}.`;
}

/** Full dashboard payload per §3.3 sections. */
export function buildDashboard(ownerId: string): DashboardResponse {
  const now = new Date();
  const all = listObligations(ownerId, { status: 'all' }).filter((o) => ['open', 'snoozed'].includes(o.status));
  const todayEnd = addDays(now, 1).toISOString();
  const weekEnd = addDays(now, 7).toISOString();
  const monthEnd = addDays(now, 30).toISOString();

  const subs = listSubscriptions(ownerId);
  const briefingItems = buildBriefingItems(ownerId);

  // Documents expiring soon: obligations of type renewal/notice with provenance within 60 days.
  const expiringSoon = all
    .filter((o) => o.document_id && o.due_at <= addDays(now, 60).toISOString())
    .slice(0, 8)
    .map((o) => ({
      documentId: o.document_id!,
      title: o.title,
      expiryLabel: `expires ${o.due_at.slice(0, 10)}`,
    }));

  return {
    today: all.filter((o) => o.due_at <= todayEnd),
    thisWeek: all.filter((o) => o.due_at > todayEnd && o.due_at <= weekEnd),
    thisMonth: all.filter((o) => o.due_at > weekEnd && o.due_at <= monthEnd),
    money: {
      subscriptions: subs,
      monthlyRecurringEstimate: Math.round(monthlyCost(subs)),
      currency: subs[0]?.currency ?? 'INR',
      upcomingPayments: all.filter((o) => o.type === 'payment').slice(0, 5),
    },
    assets: listAssets(ownerId),
    documents: {
      recent: [],
      expiringSoon,
    },
    family: [], // Phase 6 module; permissions-gated shared records land later
    briefing: {
      generatedAt: now.toISOString(),
      summary: buildBriefingSummary(briefingItems),
      items: briefingItems.slice(0, 10),
    },
  };
}