/**
 * Obligation routes (FR-007..FR-009): CRUD, complete/snooze/dismiss with
 * recurrence roll-forward, filtered listing.
 */
import { Router } from 'express';
import { CreateObligationSchema, UpdateObligationSchema } from '@lifeos/types';
import { requireAuth, type AuthedRequest } from '../auth';
import { createObligation, getObligation, listObligations, updateObligationStatus, type ObligationFilter } from '../engine/obligations';
import { audit } from '../engine/tools';

export const obligationsRouter = Router();
obligationsRouter.use(requireAuth);

obligationsRouter.get('/', (req: AuthedRequest, res) => {
  const filter: ObligationFilter = {};
  if (typeof req.query.status === 'string') filter.status = req.query.status as ObligationFilter['status'];
  if (typeof req.query.within_days === 'string') filter.withinDays = Number(req.query.within_days);
  if (typeof req.query.type === 'string') filter.type = req.query.type as ObligationFilter['type'];
  if (typeof req.query.asset_id === 'string') filter.assetId = req.query.asset_id;
  res.json({ obligations: listObligations(req.userId!, filter) });
});

obligationsRouter.post('/', (req: AuthedRequest, res) => {
  const parsed = CreateObligationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid obligation payload.', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const ob = createObligation({
    ownerId: req.userId!,
    type: d.type,
    title: d.title,
    detail: d.detail,
    dueAt: d.due_at,
    recurrence: d.recurrence,
    priority: d.priority,
    reminderPolicy: d.reminder_policy,
    assetId: d.asset_id ?? null,
  });
  audit(req.userId!, 'obligation.created', 'obligation', ob.id, { type: ob.type }, req.ip);
  res.status(201).json({ obligation: ob });
});

obligationsRouter.get('/:id', (req: AuthedRequest, res) => {
  const ob = getObligation(req.userId!, req.params.id);
  if (!ob) {
    res.status(404).json({ error: 'Obligation not found.' });
    return;
  }
  res.json({ obligation: { ...ob, overdue: ob.status === 'open' && new Date(ob.due_at) < new Date() } });
});

obligationsRouter.patch('/:id', (req: AuthedRequest, res) => {
  const parsed = UpdateObligationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid update payload.', details: parsed.error.flatten() });
    return;
  }
  const a = parsed.data;
  const snoozedUntil =
    a.action === 'snooze' ? new Date(Date.now() + (a.snooze_days ?? 3) * 86400000).toISOString() : undefined;

  const updated = updateObligationStatus(req.userId!, req.params.id, {
    status:
      a.action === 'complete' ? 'completed'
        : a.action === 'reopen' ? 'open'
          : a.action === 'dismiss' ? 'dismissed'
            : a.action === 'archive' ? 'archived'
              : a.action === 'snooze' ? 'snoozed'
                : undefined,
    dueAt: a.due_at,
    title: a.title,
    detail: a.detail,
    priority: a.priority,
    snoozedUntil,
  });
  if (!updated) {
    res.status(404).json({ error: 'Obligation not found.' });
    return;
  }
  audit(req.userId!, `obligation.${a.action}`, 'obligation', updated.id, {}, req.ip);
  res.json({ obligation: { ...updated, overdue: updated.status === 'open' && new Date(updated.due_at) < new Date() } });
});