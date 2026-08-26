/**
 * CRUD for assets & subscriptions (user request: delete / edit records).
 * Assets and subscriptions were read-only; this adds manage/delete/update.
 */
import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../auth';
import { listAssets, deleteAsset, updateAsset, listSubscriptions, deleteSubscription, updateSubscription } from '../engine/obligations';
import { audit } from '../engine/tools';

export const manageRouter = Router();
manageRouter.use(requireAuth);

/* ------------------------------ assets ------------------------------ */

manageRouter.get('/assets', (req: AuthedRequest, res) => {
  res.json({ assets: listAssets(req.userId!) });
});

manageRouter.patch('/assets/:id', (req: AuthedRequest, res) => {
  const a = req.body ?? {};
  const updated = updateAsset(req.userId!, req.params.id, {
    name: typeof a.name === 'string' ? a.name : undefined,
    type: a.type,
    metadata: typeof a.metadata === 'object' && a.metadata !== null ? a.metadata : undefined,
  });
  if (!updated) { res.status(404).json({ error: 'Asset not found.' }); return; }
  audit(req.userId!, 'asset.updated', 'asset', updated.id, { name: updated.name });
  res.json({ asset: updated });
});

manageRouter.delete('/assets/:id', (req: AuthedRequest, res) => {
  if (!deleteAsset(req.userId!, req.params.id)) {
    res.status(404).json({ error: 'Asset not found.' });
    return;
  }
  audit(req.userId!, 'asset.deleted', 'asset', req.params.id);
  res.json({ ok: true });
});

/* --------------------------- subscriptions -------------------------- */

manageRouter.get('/subscriptions', (req: AuthedRequest, res) => {
  res.json({ subscriptions: listSubscriptions(req.userId!) });
});

manageRouter.patch('/subscriptions/:id', (req: AuthedRequest, res) => {
  const s = req.body ?? {};
  const updated = updateSubscription(req.userId!, req.params.id, {
    merchant: typeof s.merchant === 'string' ? s.merchant : undefined,
    amount: typeof s.amount === 'number' ? s.amount : undefined,
    cadence: s.cadence,
    renewal_at: typeof s.renewal_at === 'string' ? s.renewal_at : undefined,
    currency: typeof s.currency === 'string' ? s.currency : undefined,
  });
  if (!updated) { res.status(404).json({ error: 'Subscription not found.' }); return; }
  audit(req.userId!, 'subscription.updated', 'subscription', updated.id);
  res.json({ subscription: updated });
});

manageRouter.delete('/subscriptions/:id', (req: AuthedRequest, res) => {
  if (!deleteSubscription(req.userId!, req.params.id)) {
    res.status(404).json({ error: 'Subscription not found.' });
    return;
  }
  audit(req.userId!, 'subscription.deleted', 'subscription', req.params.id);
  res.json({ ok: true });
});
