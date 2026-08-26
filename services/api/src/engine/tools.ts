/**
 * Agent tools & approval model (§5.4 levels, §5.5 guardrails,
 * "AI Tool & Agent Design" decision pattern).
 *
 * - The assistant operates ONLY through these typed tools (no direct DB access).
 * - Every tool enforces authorization independently (owner scoping).
 * - Every invocation is audited: what was attempted and why.
 * - Level 2+ actions never execute externally; they prepare drafts that require
 *   explicit user approval. The MVP has no outbound side effects at all —
 *   draft_email produces a reviewable draft record only.
 */
import type { AgentAction, AgentLevel } from '@lifeos/types';
import { db } from '../db';
import { nowISO, uuid } from '../util';
import { createObligation, getObligation, listObligations, listSubscriptions, updateObligationStatus } from './obligations';
import { listDocuments, excerptAround } from '../extraction/pipeline';

export interface ToolContext {
  userId: string;
  ip?: string;
  reason?: string;
}

export interface ToolResult {
  ok: boolean;
  level: AgentLevel;
  tool: string;
  data?: Record<string, unknown>;
  message: string;
  actionId?: string;
}

interface ToolDef {
  name: string;
  level: AgentLevel;
  description: string;
  run: (ctx: ToolContext, input: Record<string, unknown>) => Promise<{ data?: Record<string, unknown>; message: string; pendingApproval?: boolean }>;
}

/* --------------------------- tool registry --------------------------- */

const TOOLS: Record<string, ToolDef> = {
  search_records: {
    name: 'search_records',
    level: 0,
    description: 'Search the user\'s obligations, assets and subscriptions by keyword.',
    run: async (ctx, input) => {
      const q = String(input.query ?? '').toLowerCase();
      if (!q) return { message: 'Provide a query.' };
      const obligations = listObligations(ctx.userId, { status: 'all' }).filter((o) => o.title.toLowerCase().includes(q));
      const subs = listSubscriptions(ctx.userId).filter((s) => s.merchant.toLowerCase().includes(q));
      return {
        data: { obligations: obligations.map((o) => ({ id: o.id, title: o.title, due_at: o.due_at })), subscriptions: subs.map((s) => ({ id: s.id, merchant: s.merchant })) },
        message: `Found ${obligations.length} obligation(s), ${subs.length} subscription(s) matching "${q}".`,
      };
    },
  },

  get_document_source: {
    name: 'get_document_source',
    level: 0,
    description: 'Return an excerpt of a document the user owns (provenance view).',
    run: async (ctx, input) => {
      const docId = String(input.document_id ?? '');
      const docs = listDocuments(ctx.userId, 500);
      const doc = docs.find((d) => d.id === docId);
      if (!doc) return { message: 'Document not found or not owned by you.' };
      const row = db.prepare('SELECT raw_text FROM documents WHERE id = ?').get(docId) as { raw_text: string } | undefined;
      const start = Number(input.span_start ?? 0);
      const end = Number(input.span_end ?? Math.min(row?.raw_text.length ?? 400, start + 400));
      return { data: { title: doc.title, excerpt: row ? excerptAround(row.raw_text, start, end, 120) : '' }, message: `Excerpt from "${doc.title}".` };
    },
  },

  list_subscriptions: {
    name: 'list_subscriptions',
    level: 0,
    description: 'List active subscriptions.',
    run: async (ctx) => {
      const subs = listSubscriptions(ctx.userId);
      return { data: { subscriptions: subs }, message: `${subs.length} active subscription(s).` };
    },
  },

  create_obligation: {
    name: 'create_obligation',
    level: 1,
    description: 'Create a reminder/obligation for the user.',
    run: async (ctx, input) => {
      const ob = createObligation({
        ownerId: ctx.userId,
        type: (String(input.type ?? 'notice') as 'notice'),
        title: String(input.title ?? 'Untitled obligation'),
        detail: input.detail ? String(input.detail) : undefined,
        dueAt: String(input.due_at ?? new Date(Date.now() + 7 * 86400000).toISOString()),
        priority: (input.priority as 'low' | 'medium' | 'high' | 'critical') ?? 'medium',
      });
      return { data: { obligation_id: ob.id }, message: `Created obligation "${ob.title}" due ${ob.due_at.slice(0, 10)}.` };
    },
  },

  update_obligation: {
    name: 'update_obligation',
    level: 1,
    description: 'Update status/date of one of the user\'s obligations.',
    run: async (ctx, input) => {
      const id = String(input.obligation_id ?? '');
      const existing = getObligation(ctx.userId, id);
      if (!existing) return { message: 'Obligation not found.' };
      const updated = updateObligationStatus(ctx.userId, id, {
        status: input.status as 'completed' | undefined,
        dueAt: input.due_at ? String(input.due_at) : undefined,
      });
      return { data: { obligation: updated }, message: `Updated "${existing.title}".` };
    },
  },

  summarize_trip: {
    name: 'summarize_trip',
    level: 1,
    description: 'Summarize travel readiness for upcoming trips.',
    run: async (ctx) => {
      const trips = listObligations(ctx.userId, { status: 'open', type: 'travel_requirement' });
      return {
        data: { trips: trips.map((t) => ({ id: t.id, title: t.title, due_at: t.due_at, detail: t.detail })) },
        message: trips.length > 0 ? `${trips.length} trip(s) in preparation.` : 'No upcoming trips.',
      };
    },
  },

  draft_email: {
    name: 'draft_email',
    level: 2,
    description: 'Prepare an email draft using verified facts. Requires explicit user approval; nothing is sent automatically (§5.5).',
    run: async (_ctx, input) => {
      // Guardrail: no external message is sent merely because an AI inferred intent.
      return {
        data: { to: input.to, subject: input.subject, body: input.body, state: 'draft_prepared_never_sent_without_approval' },
        message: 'Email draft prepared. It will not be sent until you explicitly approve it.',
        pendingApproval: true,
      };
    },
  },

  request_confirmation: {
    name: 'request_confirmation',
    level: 5,
    description: 'Request explicit user confirmation for a high-impact external action.',
    run: async (_ctx, input) => ({
      data: { proposed_action: input.action ?? 'unspecified', state: 'awaiting_explicit_user_approval' },
      message: 'High-impact action requires your explicit approval every time (agent level 5).',
      pendingApproval: true,
    }),
  },
};

export function listTools(): Array<{ name: string; level: AgentLevel; description: string }> {
  return Object.values(TOOLS).map((t) => ({ name: t.name, level: t.level, description: t.description }));
}

/**
 * Execute a tool on behalf of a user with full authorization scoping and audit.
 * Implements the "Agent Decision Pattern" steps 6-9 for typed tools.
 */
export async function executeTool(ctx: ToolContext, toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
  const tool = TOOLS[toolName];
  if (!tool) {
    audit(ctx.userId, 'agent.tool.unknown', 'tool', toolName, { input }, ctx.ip);
    return { ok: false, level: 0, tool: toolName, message: `Unknown tool "${toolName}".` };
  }

  let result: ToolResult;
  try {
    const out = await tool.run(ctx, input);
    const actionId = uuid();
    const approval: AgentAction['approval'] = out.pendingApproval ? 'pending' : 'not_required';
    const status: AgentAction['status'] = out.pendingApproval ? 'awaiting_approval' : 'succeeded';
    db.prepare('INSERT INTO agent_actions (id, user_id, tool, level, input, result, approval, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(actionId, ctx.userId, tool.name, tool.level, JSON.stringify(input), JSON.stringify(out.data ?? {}), approval, status, nowISO());
    audit(ctx.userId, 'agent.tool.invoked', 'tool', tool.name, { level: tool.level, reason: ctx.reason ?? null, awaiting_approval: out.pendingApproval === true }, ctx.ip);
    result = { ok: true, level: tool.level, tool: tool.name, data: out.data, message: out.message, actionId };
  } catch (err) {
    audit(ctx.userId, 'agent.tool.failed', 'tool', tool.name, { error: String(err) }, ctx.ip);
    result = { ok: false, level: tool.level, tool: tool.name, message: `Tool failed: ${String(err)}` };
  }
  return result;
}

/** Approve a pending agent action (e.g., a prepared email draft). */
export function approveAction(userId: string, actionId: string): { ok: boolean; message: string } {
  const row = db.prepare('SELECT * FROM agent_actions WHERE id = ? AND user_id = ?').get(actionId, userId) as Record<string, unknown> | undefined;
  if (!row) return { ok: false, message: 'Action not found.' };
  if (row.approval !== 'pending') return { ok: false, message: 'Action does not require approval.' };

  // MVP guardrail: even approved drafts are NOT transmitted anywhere. They are
  // marked ready-for-user so the user can copy/send them through their own channel.
  db.prepare("UPDATE agent_actions SET approval = 'approved', status = 'succeeded', result = json_set(result, '$.state', 'approved_ready_for_user_to_send') WHERE id = ?")
    .run(actionId);
  audit(userId, 'agent.action.approved', 'agent_action', actionId, { note: 'No external transmission occurs in MVP.' });
  return { ok: true, message: 'Approved. The draft is marked ready — LifeOS never sends it without a connected, consented channel (none exists in MVP).' };
}

export function rejectAction(userId: string, actionId: string): { ok: boolean; message: string } {
  const res = db.prepare("UPDATE agent_actions SET approval = 'rejected', status = 'failed' WHERE id = ? AND user_id = ? AND approval = 'pending'")
    .run(actionId, userId);
  if (res.changes === 0) return { ok: false, message: 'Pending action not found.' };
  audit(userId, 'agent.action.rejected', 'agent_action', actionId, {});
  return { ok: true, message: 'Rejected.' };
}

export function listAgentActions(userId: string): AgentAction[] {
  const rows = db.prepare('SELECT * FROM agent_actions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(userId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    user_id: String(r.user_id),
    tool: String(r.tool),
    level: Number(r.level) as AgentLevel,
    input: JSON.parse(String(r.input)) as Record<string, unknown>,
    result: r.result ? (JSON.parse(String(r.result)) as Record<string, unknown>) : null,
    approval: r.approval as AgentAction['approval'],
    status: r.status as AgentAction['status'],
    created_at: String(r.created_at),
  }));
}

/* ------------------------------ audit -------------------------------- */

export function audit(
  actor: string,
  eventType: string,
  resourceType?: string,
  resourceId?: string,
  metadata?: Record<string, unknown>,
  ip?: string
): void {
  db.prepare('INSERT INTO audit_events (id, actor, event_type, resource_type, resource_id, metadata, ip, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuid(), actor, eventType, resourceType ?? null, resourceId ?? null, metadata ? JSON.stringify(metadata) : null, ip ?? null, nowISO());
}