/**
 * Assistant & agent routes (FR-011, FR-019):
 * - GET  /assistant?q=          grounded Q&A over authorized records
 * - GET  /agent/tools           tool registry with levels
 * - POST /agent/tools/:tool     execute a typed tool (audited, approval-gated)
 * - GET  /agent/actions         action log
 * - POST /agent/actions/:id/approve|reject   explicit approval flow
 */
import { Router } from 'express';
import { DraftEmailSchema } from '@lifeos/types';
import { requireAuth, type AuthedRequest } from '../auth';
import { answerQuestion } from '../engine/assistant';
import { approveAction, executeTool, listAgentActions, listTools, rejectAction } from '../engine/tools';

export const assistantRouter = Router();
export const agentRouter = Router();

assistantRouter.use(requireAuth);
agentRouter.use(requireAuth);

assistantRouter.get('/', (req: AuthedRequest, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    res.status(400).json({ error: 'Provide a question via ?q=' });
    return;
  }
  res.json(answerQuestion(req.userId!, q));
});

agentRouter.get('/tools', (_req: AuthedRequest, res) => {
  res.json({ tools: listTools() });
});

agentRouter.post('/tools/:tool', async (req: AuthedRequest, res) => {
  const input = (req.body?.input ?? req.body ?? {}) as Record<string, unknown>;
  const result = await executeTool(
    { userId: req.userId!, ip: req.ip, reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined },
    req.params.tool,
    input
  );
  res.status(result.ok ? 200 : 400).json(result);
});

/** Convenience endpoint for the UC-019 "draft email to provider" flow. */
agentRouter.post('/draft-email', async (req: AuthedRequest, res) => {
  const parsed = DraftEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid draft payload.', details: parsed.error.flatten() });
    return;
  }
  const result = await executeTool(
    { userId: req.userId!, ip: req.ip, reason: 'user requested provider email draft' },
    'draft_email',
    parsed.data as unknown as Record<string, unknown>
  );
  res.json(result);
});

agentRouter.get('/actions', (req: AuthedRequest, res) => {
  res.json({ actions: listAgentActions(req.userId!) });
});

agentRouter.post('/actions/:id/approve', (req: AuthedRequest, res) => {
  const r = approveAction(req.userId!, req.params.id);
  res.status(r.ok ? 200 : 404).json(r);
});

agentRouter.post('/actions/:id/reject', (req: AuthedRequest, res) => {
  const r = rejectAction(req.userId!, req.params.id);
  res.status(r.ok ? 200 : 404).json(r);
});