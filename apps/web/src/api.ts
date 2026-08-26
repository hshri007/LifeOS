/** Typed fetch client for the LifeOS API. Token kept in localStorage. */

const TOKEN_KEY = 'lifeos_token';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string): void => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts.body && typeof opts.body === 'string') headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, { ...opts, headers });
  if (res.status === 401 && !path.startsWith('/auth')) {
    clearToken();
    window.location.href = '/login';
    throw new ApiError(401, 'Session expired');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/* ------------------------------ types ------------------------------ */

export interface ObligationRow {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  due_at: string;
  recurrence: string;
  status: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  overdue: boolean;
  document_id: string | null;
  asset_id: string | null;
}

export interface DocumentRow {
  id: string;
  title: string;
  category: string;
  source: string;
  status: string;
  created_at: string;
}

export interface FieldRow {
  id: string;
  field: string;
  value: string;
  normalized_value: string | null;
  confidence: number;
  requires_confirmation: boolean;
  confirmed: boolean;
}

export interface DashboardData {
  today: ObligationRow[];
  thisWeek: ObligationRow[];
  thisMonth: ObligationRow[];
  money: {
    subscriptions: Array<{ id: string; merchant: string; amount: number; currency: string; cadence: string; renewal_at: string }>;
    monthlyRecurringEstimate: number;
    currency: string;
    upcomingPayments: ObligationRow[];
  };
  assets: Array<{ id: string; type: string; name: string; metadata: Record<string, unknown> }>;
  documents: { recent: DocumentRow[]; expiringSoon: Array<{ documentId: string; title: string; expiryLabel: string }> };
  briefing: { generatedAt: string; summary: string; items: Array<{ obligationId: string; title: string; why: string; priority: string; overdue: boolean }> };
}

export interface AssistantAnswerData {
  intent: string;
  answer: string;
  sources: Array<{ documentId: string; title: string }>;
}