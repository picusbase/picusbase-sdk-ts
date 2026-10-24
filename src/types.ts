export type PicusConfig = {
  /** Console API base URL, e.g. https://console.example.com */
  consoleUrl: string;
  authUrl: string;
  functionsUrl: string;
  projectRef: string;
  /** OAuth client for the browser sign-in. Defaults to the platform-wide client. */
  oauthClientId?: string;
};

export type EntityRecord<T = Record<string, unknown>> = {
  id: string;
  entity_code: string;
  data: T;
  created_at: string | null;
  updated_at: string | null;
};

export type FilterOp = 'eq' | 'ne' | 'contains' | 'starts_with' | 'gt' | 'gte' | 'lt' | 'lte' | 'empty' | 'not_empty';

export type ListOptions = {
  page?: number;
  limit?: number;
  /** Full-text search over the entity's text fields. */
  q?: string;
  /** All must match. */
  filters?: [field: string, op: FilterOp, value: string][];
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  /** Sort by the trailing number of `orderBy` (room 2 before room 10). */
  orderNatural?: boolean;
  /** `any` = a record matching ONE filter is enough (default `all`). */
  filterMatch?: 'all' | 'any';
};

export type AggregateOptions = {
  groupBy: string[];
  metricField: string;
  metric: 'sum' | 'count';
  filters?: ListOptions['filters'];
  /** Date field filtered by `from`/`to` (inclusive, YYYY-MM-DD). */
  dateField?: string;
  from?: string;
  to?: string;
};

export type Comment = { id: string; author_label: string; body: string; created_at?: string; mine: boolean };
export type Member = { id: string; label: string };
export type ActivityEntry = { actor_label: string; action: string; summary: string; created_at: string };
export type Attachment = {
  id: string;
  filename: string;
  content_type: string;
  is_image: boolean;
  size_bytes: number;
  created_at: string;
  download_url: string;
};

export type User = { id: string; email?: string };

export type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number };
