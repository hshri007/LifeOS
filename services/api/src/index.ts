/**
 * LifeOS API server bootstrap.
 *
 * Modular monolith per §8.1: identity, documents, extraction, obligations,
 * notifications, AI orchestration and audit live behind one gateway process
 * for the MVP; each module boundary is a future service split point.
 */
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config';
import { handleLogin, handleLogout, handleRegister } from './auth';
import { documentsRouter } from './routes/documents';
import { obligationsRouter } from './routes/obligations';
import { assistantRouter, agentRouter } from './routes/assistant';
import { miscRouter } from './routes/misc';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '2mb' }));

// Correlation IDs for observability (§8.5).
app.use((req, res, next) => {
  const id = req.headers['x-request-id'] ?? crypto.randomUUID();
  res.setHeader('x-request-id', String(id));
  next();
});

// Simple request log (stdout; centralized logging in production per §8.3).
app.use((req, _res, next) => {
  if (!req.path.startsWith('/api')) return next();
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

/* ------------------------------ routes ------------------------------ */

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'lifeos-api', time: new Date().toISOString() }));

app.post('/api/auth/register', handleRegister);
app.post('/api/auth/login', handleLogin);
app.post('/api/auth/logout', handleLogout);

app.use('/api/documents', documentsRouter);
app.use('/api/obligations', obligationsRouter);
app.use('/api/assistant', assistantRouter);
app.use('/api/agent', agentRouter);
app.use('/api', miscRouter);

/* --------------------------- static web UI -------------------------- */

// Serve the built web app when present (single-process deployment convenience).
const webDist = path.resolve(__dirname, '../../../apps/web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

/* ---------------------------- error handler ------------------------- */

app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`[error] ${err.message}`);
  res.status(err.status ?? 500).json({ error: err.message || 'Internal server error.' });
});

app.listen(config.port, () => {
  console.log(`LifeOS API listening on http://localhost:${config.port} (${config.env})`);
});