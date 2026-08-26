/**
 * LifeOS shared domain types & schemas.
 * Mirrors the Master Specification:
 *  - Core data model ............ §8.4
 *  - Document categories ........ §2.3
 *  - Obligation model ........... §2.5
 *  - Reminder logic ............. §2.6
 *  - Agent levels / tools ....... §5.4 + "AI Tool & Agent Design"
 *  - Consent center ............. §4.6
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export type ID = string;
/** UTC ISO-8601 timestamp, e.g. 2026-08-26T04:00:00.000Z */
export type ISODateTime = string;

/* ------------------------------------------------------------------ */
/* Document categories (§2.3)                                          */
/* ------------------------------------------------------------------ */

export const DOCUMENT_CATEGORIES = [
  'insurance',
  'purchase_invoice',
  'warranty',
  'vehicle',
  'travel',
  'subscription',
  'bills',
  'property',
  'other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/* ------------------------------------------------------------------ */
/* Obligation model (§2.5)                                             */
/* ------------------------------------------------------------------ */

export const OBLIGATION_TYPES = [
  'payment',
  'renewal',
  'return_deadline',
  'warranty_claim',
  'service',
  'appointment',
  'travel_requirement',
  'notice',
] as const;
export type ObligationType = (typeof OBLIGATION_TYPES)[number];

/** Stored status; `overdue` is derived from due_at < now && status === 'open'. */
export const OBLIGATION_STATUSES = ['open', 'completed', 'snoozed', 'dismissed', 'archived'] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const RECURRENCES = ['none', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

/** Days-before-due offsets for the default reminder schedule (§2.6). */
export type ReminderPolicy = number[];

export interface Provenance {
  documentId: ID;
  documentTitle: string;
  /** Character span in the source text backing the fact (FR-005). */
  spans: Array<[number, number]>;
}

export interface Obligation {
  id: ID;
  owner_id: ID;
  asset_id?: ID | null;
  document_id?: ID | null;
  type: ObligationType;
  title: string;
  detail?: string | null;
  due_at: ISODateTime;
  recurrence: Recurrence;
  status: ObligationStatus;
  priority: Priority;
  reminder_policy: ReminderPolicy;
  action_plan?: string | null;
  provenance?: Provenance | null;
  snoozed_until?: ISODateTime | null;
  completed_at?: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* Documents & extraction (§2.4)                                       */
/* ------------------------------------------------------------------ */

export type DocumentStatus = 'received' | 'processing' | 'extracted' | 'confirmed' | 'failed';

export interface DocumentRecord {
  id: ID;
  owner_id: ID;
  title: string;
  category: DocumentCategory;
  source: 'upload' | 'email_forward' | 'manual' | 'csv_import';
  mime_type: string;
  size_bytes: number;
  hash: string;
  storage_ref: string;
  status: DocumentStatus;
  created_at: ISODateTime;
}

export interface DocumentField {
  id: ID;
  document_id: ID;
  field: string;
  value: string;
  normalized_value?: string | null;
  confidence: number; // 0..1
  span_start: number;
  span_end: number;
  /** High-impact fields require user confirmation before records are created (§2.4). */
  requires_confirmation: boolean;
  confirmed: boolean;
}

export interface ExtractedField {
  field: string;
  value: string;
  normalizedValue?: string;
  confidence: number;
  span: [number, number];
  requiresConfirmation: boolean;
}

export interface ClassificationScore {
  category: DocumentCategory;
  score: number;
}

export interface ExtractionResult {
  category: DocumentCategory;
  classificationScores: ClassificationScore[];
  fields: ExtractedField[];
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Assets / Subscriptions / Events                                     */
/* ------------------------------------------------------------------ */

export type AssetType = 'vehicle' | 'electronics' | 'appliance' | 'property' | 'other';

export interface Asset {
  id: ID;
  owner_id: ID;
  type: AssetType;
  name: string;
  metadata: Record<string, unknown>;
  created_at: ISODateTime;
}

export type Cadence = 'monthly' | 'quarterly' | 'semiannual' | 'annual';

export interface Subscription {
  id: ID;
  owner_id: ID;
  merchant: string;
  amount: number;
  currency: string;
  cadence: Cadence;
  renewal_at: ISODateTime;
  category: string;
  status: 'active' | 'cancelled';
  document_id?: ID | null;
  created_at: ISODateTime;
}

export interface EventItem {
  id: ID;
  owner_id: ID;
  title: string;
  start_at: ISODateTime;
  end_at?: ISODateTime | null;
  location?: string | null;
  source: 'user' | 'calendar' | 'travel_doc';
  created_at: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* Identity, permissions, integrations, audit                          */
/* ------------------------------------------------------------------ */

export interface User {
  id: ID;
  email: string;
  locale: string;
  timezone: string;
  status: 'active' | 'disabled';
  mfa_enabled: boolean;
  created_at: ISODateTime;
}

export interface Household {
  id: ID;
  name: string;
  owner_id: ID;
  created_at: ISODateTime;
}

export interface Integration {
  id: ID;
  owner_id: ID;
  provider: string;
  scopes: string[];
  status: 'connected' | 'revoked';
  last_sync_at?: ISODateTime | null;
  created_at: ISODateTime;
}

export interface PermissionGrant {
  id: ID;
  subject_id: ID;
  resource_owner_id: ID;
  resource_type: 'document' | 'asset' | 'obligation' | 'subscription';
  resource_id: ID;
  role: 'viewer' | 'manager';
  granted_fields: string[] | null;
  expires_at?: ISODateTime | null;
  created_at: ISODateTime;
}

export type AgentLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface AgentAction {
  id: ID;
  user_id: ID;
  tool: string;
  level: AgentLevel;
  input: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  approval: 'not_required' | 'pending' | 'approved' | 'rejected';
  status: 'succeeded' | 'failed' | 'awaiting_approval';
  created_at: ISODateTime;
}

export interface AuditEvent {
  id: ID;
  actor: ID | 'system';
  event_type: string;
  resource_type?: string | null;
  resource_id?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  timestamp: ISODateTime;
}

export interface NotificationItem {
  id: ID;
  user_id: ID;
  obligation_id?: ID | null;
  kind: 'reminder' | 'briefing' | 'system';
  title: string;
  body: string;
  scheduled_for: ISODateTime;
  sent_at?: ISODateTime | null;
  read_at?: ISODateTime | null;
  dedupe_key: string;
  status: 'scheduled' | 'sent' | 'read';
}

/* ------------------------------------------------------------------ */
/* Dashboard (§3.3) & briefing (§5.3)                                  */
/* ------------------------------------------------------------------ */

export interface BriefingItem {
  obligationId: ID;
  title: string;
  why: string;
  dueAt: ISODateTime;
  priority: Priority;
  overdue: boolean;
}

export interface DashboardResponse {
  today: Obligation[];
  thisWeek: Obligation[];
  thisMonth: Obligation[];
  money: {
    subscriptions: Subscription[];
    monthlyRecurringEstimate: number;
    currency: string;
    upcomingPayments: Obligation[];
  };
  assets: Asset[];
  documents: { recent: DocumentRecord[]; expiringSoon: Array<{ documentId: ID; title: string; expiryLabel: string }> };
  family: Obligation[];
  briefing: { generatedAt: ISODateTime; summary: string; items: BriefingItem[] };
}

/* ------------------------------------------------------------------ */
/* Grounded assistant (§5.1–5.2)                                       */
/* ------------------------------------------------------------------ */

export type AssistantIntent =
  | 'what_needs_attention'
  | 'expiring_soon'
  | 'list_subscriptions'
  | 'recurring_cost'
  | 'vehicle_status'
  | 'trip_readiness'
  | 'active_warranties'
  | 'find_document'
  | 'draft_email'
  | 'unknown';

export interface AssistantSource {
  documentId: ID;
  title: string;
  fields: string[];
}

export interface AssistantAnswer {
  intent: AssistantIntent;
  answer: string;
  items: BriefingItem[];
  sources: AssistantSource[];
  grounded: true;
}

/* ------------------------------------------------------------------ */
/* API validation schemas                                              */
/* ------------------------------------------------------------------ */

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  timezone: z.string().default('Asia/Kolkata'),
  locale: z.string().default('en-IN'),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const UploadTextSchema = z.object({
  title: z.string().min(1).max(200),
  text: z.string().min(10).max(200_000),
  source: z.enum(['upload', 'email_forward', 'manual', 'csv_import']).default('upload'),
  senderHint: z.string().max(200).optional(),
});
export type UploadTextInput = z.infer<typeof UploadTextSchema>;

export const ConfirmFieldsSchema = z.object({
  fields: z.array(
    z.object({
      field: z.string().min(1),
      value: z.string().min(0),
    })
  ),
  createRecords: z.boolean().default(true),
});
export type ConfirmFieldsInput = z.infer<typeof ConfirmFieldsSchema>;

export const CreateObligationSchema = z.object({
  type: z.enum(OBLIGATION_TYPES),
  title: z.string().min(1).max(200),
  detail: z.string().max(2000).optional(),
  due_at: z.string().datetime(),
  recurrence: z.enum(RECURRENCES).default('none'),
  priority: z.enum(PRIORITIES).default('medium'),
  reminder_policy: z.array(z.number().int().min(0).max(365)).optional(),
  asset_id: z.string().uuid().optional(),
});
export type CreateObligationInput = z.infer<typeof CreateObligationSchema>;

export const UpdateObligationSchema = z.object({
  action: z.enum(['complete', 'snooze', 'reopen', 'dismiss', 'archive', 'edit']),
  due_at: z.string().datetime().optional(),
  snooze_days: z.number().int().min(1).max(365).optional(),
  title: z.string().min(1).max(200).optional(),
  detail: z.string().max(2000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  recurrence: z.enum(RECURRENCES).optional(),
  type: z.enum(OBLIGATION_TYPES).optional(),
});
export type UpdateObligationInput = z.infer<typeof UpdateObligationSchema>;

export const DraftEmailSchema = z.object({
  to: z.string().min(3).max(320),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20_000),
  context_document_id: z.string().uuid().optional(),
});
export type DraftEmailInput = z.infer<typeof DraftEmailSchema>;

export const IngestEmailSchema = z.object({
  sender: z.string().min(3).max(320),
  subject: z.string().min(1).max(500),
  body: z.string().min(10).max(200_000),
  receivedAt: z.string().datetime().optional(),
});
export type IngestEmailInput = z.infer<typeof IngestEmailSchema>;