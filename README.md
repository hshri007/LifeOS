# LifeOS

A privacy-first AI personal operations platform that turns documents, messages, subscriptions, deadlines and life events into actionable tasks and workflows.

Built against the **LifeOS Master Product, Technical, Security & Go-To-Market Specification** (v1.0).

---

## 🚀 Quick start

> ⚠️ **Important:** always run the API from `services/api/` (or use the workspace scripts below). Running `tsx src/index.ts` from the repo root fails with `ERR_MODULE_NOT_FOUND`.

```bash
# 1. Install everything
npm install

# 2. Start BOTH servers with one command
npm run dev
#    • Web app → http://localhost:5173   (open this)
#    • API     → http://localhost:4000
#    Press Ctrl-C to stop both.

# 3. Optional: load demo documents for the seeded account
npm run seed        # creates demo@lifeos.app / LifeOS!demo123
```

<details>
<summary>Prefer separate terminals?</summary>

```bash
npm run dev:api   # terminal 1 — API on :4000
npm run dev:web   # terminal 2 — web on :5173
```
</details>

Open **http://localhost:5173** — sign up, or click **"✦ Explore the live demo"** for a one-click session.

### Single-process mode (production-style)

```bash
npm run build -w apps/web     # builds apps/web/dist
cd services/api && npm start  # API also serves the SPA on :4000
```

---

## ✅ What is built (working & tested)

### Phase 1–2 — Document intelligence & obligation engine (MVP core loop)
- Email/password auth with scrypt hashing, hashed bearer-token sessions, rate limiting (FR-001)
- **Email OTP verification** at signup — 6-digit code, expiry + attempt limits, resend; code is emailed via SMTP when configured, or surfaced transparently as a DEV MODE code otherwise (never silently faked)
- One-click **demo login** (`POST /api/auth/demo`) + session validation (`GET /api/auth/me`)
- **Manual record entry** — add details directly (PUC, insurance, subscription, bills, trips, property) with no document, creating real obligations (user request)
- Document ingest: paste text or upload `.txt/.md/.csv/.json`, size limits, MIME checks, content-hash dedupe (FR-003)
- Deterministic extraction pipeline: classify → extract typed fields → normalize dates/money → confidence scores → character-span provenance (FR-004, FR-005)
- Field correction before confirmation (FR-006), confirm-and-derive (§2.4 steps 9–10)
- Derivation into assets, subscriptions, events and obligations across categories (UC-001…UC-008, UC-012, UC-023/024)

### Phase 3 — Dashboard & assistant
- **Redesigned dashboard**: priority stat tiles + quick actions
- Prioritized AI briefing (overdue first, then priority weight, then date) — §5.3
- Today / this week / this month buckets, recurring-money estimate, expiring documents, assets (§3.3)
- Grounded deterministic Q&A assistant with intent detection and source citations (FR-011, §5.2)

### Phase 4 — Integrations groundwork
- **Honest consent center**: Gmail/Calendar OAuth providers are REFUSED until Google OAuth is configured (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) — the app never fakes a connection; the functional email-forwarding path connects freely (§4.6)
- Simulated email-forwarding ingestion with sender allow-list + dedupe (§4.2)
- **Reminder → notification pipeline**: synchronization (dashboard poll auto-runs the tick) generates in-app reminders by reminder-policy offsets, surfaced in a 🔔 notification bell with unread badge + mark-all-read; dedupe keys (§2.6)
- **Authenticated data export** fixed (FR-014) — prior `window.open` dropped the auth header; now uses fetch→blob download
- Reminder worker tick materializes notifications per reminder policy offsets with dedupe keys (§2.6)

### Phase 5 — Agent tools & approval model
- Typed tool registry (`search_records`, `create_obligation`, `draft_email`, …) with levels 0–5 (§5.4)
- Level-2 drafts never auto-send; explicit approve/reject flow; full agent action log (§5.5 guardrails)

### Phase 7–8 foundations
- SQLite schema mirroring §8.4 (users, sessions, profiles, households, documents, fields, assets, obligations, subscriptions, events, integrations, permissions, agent_actions, audit_events, notifications, ingest_emails) with tenant scoping on every query
- Correlation IDs, request logging, CORS config, environment-based secrets (no hardcoded credentials)
- Audit log UI + export-all-data / delete-account endpoints (FR-013, FR-014, FR-015)

### Quality gates passing
- `npm test` — 18/18 unit/integration tests (date parsing, money parsing, extraction accuracy, recurrence roll-forward, reminder dedupe, UC-001 derivation, provenance spans)
- `npm run typecheck` — clean across all three packages
- Web build — 63 KB gzipped JS bundle

---

## 🚧 What is still pending (per spec roadmap)

| Spec phase | Gap | Notes |
|---|---|---|
| FR-002 (MFA/passkeys) | Schema hook exists (`users.mfa_enabled`); no enrollment flow | Phase 7 hardening |
| PDF/image OCR | Upload accepts text formats only; paste works for anything | Needs vendor-isolated parser service (§7.1) |
| Real OAuth integrations | Gmail/Calendar are catalog entries + consent state only | Requires Google OAuth app + token vault |
| Mobile apps (§8.3) | React Native/Flutter not started | Web first |
| PostgreSQL migration | SQLite behind a single connection module, swap-ready | Prod scale |
| Family sharing UI (§6.6) | `permissions` table exists; no household flows in UI | UC-011, UC-022 |
| Life-event workflows (§6.9) | Not started (moving home, buying car, etc.) | Phase 6+ |
| Notifications channels | In-app only; no push/email/SMS delivery | Needs provider accounts |
| LLM layer (§5.1) | Assistant is deterministic retrieval; LLM rephrase slot reserved | Provider-agnostic gateway planned |
| Marketplace (FR-020) | Not started | Later |

---

## 🔧 Troubleshooting

**Login says "Can't reach the LifeOS server"**
The API isn't running (or crashed). Run `npm run dev:api` and watch for `LifeOS API listening on http://localhost:4000`.

**Port already in use**
```bash
lsof -ti:4000 | xargs kill -9   # then restart
```

**Tests / types**
```bash
npm test          # API unit + integration tests
npm run typecheck # all workspaces
```
