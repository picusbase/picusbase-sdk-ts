import { AuthClient } from './auth.js';
import { errorText } from './http.js';
import type {
  ActivityEntry,
  AggregateOptions,
  Attachment,
  Comment,
  EntityRecord,
  ListOptions,
  Member,
  PicusConfig,
} from './types.js';

type RawBody = { contentType: string; filename: string };

const recordPath = (entity: string, id: string) => `/entities/${entity}/records/${encodeURIComponent(id)}`;

const rawBody = (file: File): RawBody => ({
  contentType: file.type || 'application/octet-stream',
  filename: file.name,
});

function listQuery(opts: ListOptions): string {
  const params = new URLSearchParams({ page: String(opts.page ?? 1), limit: String(opts.limit ?? 20) });
  if (opts.q) params.set('q', opts.q);
  if (opts.filters?.length) params.set('filters', JSON.stringify(opts.filters));
  if (opts.orderBy) params.set('order_by', opts.orderBy);
  if (opts.orderDir) params.set('order_dir', opts.orderDir);
  if (opts.orderNatural) params.set('order_natural', 'true');
  if (opts.filterMatch === 'any') params.set('filter_match', 'any');
  return params.toString();
}

function aggregateQuery(opts: AggregateOptions): string {
  const params = new URLSearchParams({
    group_by: opts.groupBy.join(','),
    metric_field: opts.metricField,
    metric: opts.metric,
  });
  if (opts.filters?.length) params.set('filters', JSON.stringify(opts.filters));
  if (opts.dateField) params.set('date_field', opts.dateField);
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  return params.toString();
}

export class PicusClient {
  readonly auth: AuthClient;

  constructor(private readonly config: PicusConfig) {
    this.auth = new AuthClient(config);
  }

  /** Entity records. The type argument is the record's data shape, e.g. `records.list<Order>('sales_order')`. */
  readonly records = {
    list: <T = Record<string, unknown>>(entity: string, opts: ListOptions = {}) =>
      this.consoleApi<EntityRecord<T>[]>('GET', `/entities/${entity}/records?${listQuery(opts)}`),
    get: <T = Record<string, unknown>>(entity: string, id: string) =>
      this.consoleApi<EntityRecord<T>>('GET', recordPath(entity, id)),
    create: <T = Record<string, unknown>>(entity: string, data: Partial<T>) =>
      this.consoleApi<EntityRecord<T>>('POST', `/entities/${entity}/records`, { data }),
    /** Replaces EVERY field (missing ones become null) — send the whole record, or use `patch`. */
    update: <T = Record<string, unknown>>(entity: string, id: string, data: Partial<T>) =>
      this.consoleApi<EntityRecord<T>>('PATCH', recordPath(entity, id), { data }),
    /** Changes only the given fields (reads the current record first). */
    patch: async <T = Record<string, unknown>>(entity: string, id: string, changes: Partial<T>) => {
      const current = await this.consoleApi<EntityRecord<T>>('GET', recordPath(entity, id));
      return this.consoleApi<EntityRecord<T>>('PATCH', recordPath(entity, id), { data: { ...current.data, ...changes } });
    },
    remove: (entity: string, id: string) =>
      this.consoleApi<{ deleted: boolean; id: string }>('DELETE', recordPath(entity, id)),
    /** Rows of the group-by columns plus `metric_value`. */
    aggregate: (entity: string, opts: AggregateOptions) =>
      this.consoleApi<Record<string, unknown>[]>('GET', `/entities/${entity}/aggregate?${aggregateQuery(opts)}`),
  };

  /** Comments, activity log, attachments, tags and assignees of one record. */
  readonly recordExtras = {
    comments: (entity: string, id: string) =>
      this.consoleApi<Comment[]>('GET', `${recordPath(entity, id)}/comments`),
    addComment: (entity: string, id: string, body: string) =>
      this.consoleApi<Comment>('POST', `${recordPath(entity, id)}/comments`, { body }),
    removeComment: (entity: string, id: string, commentId: string) =>
      this.consoleApi<{ deleted: boolean }>('DELETE', `${recordPath(entity, id)}/comments/${commentId}`),
    activity: (entity: string, id: string) =>
      this.consoleApi<ActivityEntry[]>('GET', `${recordPath(entity, id)}/activity`),
    attachments: (entity: string, id: string) =>
      this.consoleApi<Attachment[]>('GET', `${recordPath(entity, id)}/attachments`),
    attach: (entity: string, id: string, file: File) =>
      this.consoleApi<Attachment>('POST', `${recordPath(entity, id)}/attachments`, file, rawBody(file)),
    removeAttachment: (entity: string, id: string, attachmentId: string) =>
      this.consoleApi<{ deleted: boolean }>('DELETE', `${recordPath(entity, id)}/attachments/${attachmentId}`),
    tags: (entity: string, id: string) => this.consoleApi<string[]>('GET', `${recordPath(entity, id)}/tags`),
    /** Every tag already used on this entity (suggestions). */
    entityTags: (entity: string) => this.consoleApi<string[]>('GET', `/entities/${entity}/tags`),
    addTag: (entity: string, id: string, tag: string) =>
      this.consoleApi<{ tag: string }>('POST', `${recordPath(entity, id)}/tags`, { tag }),
    removeTag: (entity: string, id: string, tag: string) =>
      this.consoleApi<{ deleted: boolean }>('DELETE', `${recordPath(entity, id)}/tags/${encodeURIComponent(tag)}`),
    /** Project members that can be assigned. */
    members: () => this.consoleApi<Member[]>('GET', '/members'),
    assignees: (entity: string, id: string) =>
      this.consoleApi<(Member & { mine: boolean })[]>('GET', `${recordPath(entity, id)}/assignees`),
    addAssignee: (entity: string, id: string, assigneeId: string) =>
      this.consoleApi<Member>('POST', `${recordPath(entity, id)}/assignees`, { assignee_id: assigneeId }),
    removeAssignee: (entity: string, id: string, assigneeId: string) =>
      this.consoleApi<{ deleted: boolean }>('DELETE', `${recordPath(entity, id)}/assignees/${assigneeId}`),
  };

  readonly storage = {
    /** Stores a file in the project's upload bucket; the returned `url` goes into an `image` field. */
    uploadFile: (file: File) =>
      this.consoleApi<{ url: string; key: string }>('POST', '/uploads', file, rawBody(file)),
    /**
     * Browser-loadable URL for a console-api file path (from `uploadFile` or an attachment's
     * `download_url`). `<img>` and `<a>` cannot send headers, so the token rides in the query.
     */
    fileUrl: async (path: string): Promise<string> => {
      if (!path.startsWith('/platform/')) return path;
      const token = await this.auth.accessToken();
      const separator = path.includes('?') ? '&' : '?';
      return `${this.config.consoleUrl}${path}${token ? `${separator}token=${encodeURIComponent(token)}` : ''}`;
    },
  };

  readonly functions = {
    /** Calls any route bound to a Picus Function (see `picusbase route list`). */
    request: <T = unknown>(method: string, path: string, body?: unknown) =>
      this.requestFunction<T>(method, path, body),
    /** `POST /functions/<key>/execute`, the route `picusbase function run` uses. */
    call: <T = unknown>(functionKey: string, params: unknown = {}) => this.callFunction<T>(functionKey, params),
    /** Throws the business error (`ok: false` + `reason`/`message`/`error`), so callers handle only the success shape. */
    invoke: <T = Record<string, unknown>>(functionKey: string, params: Record<string, unknown> = {}) =>
      this.invokeFunction<T>(functionKey, params),
    /** `invoke` for `action`-style functions (`{ action, ...params }`). */
    runAction: <T = Record<string, unknown>>(functionKey: string, action: string, params: Record<string, unknown> = {}) =>
      this.invokeFunction<T>(functionKey, { action, ...params }),
    /** `invoke` for report-style functions, returning their `rows`. */
    query: async <T = Record<string, unknown>>(functionKey: string, params: Record<string, unknown> = {}) => {
      const result = await this.invokeFunction<Record<string, unknown>>(functionKey, params);
      return { ...result, rows: Array.isArray(result.rows) ? (result.rows as T[]) : [] };
    },
  };

  runWorkflow(id: string): Promise<{ status: string; error?: string }> {
    return this.consoleApi('POST', `/workflows/${encodeURIComponent(id)}/run`, {});
  }

  /** Role names of the signed-in user in this project, for showing or hiding actions only. */
  myRoles(): Promise<{ roles: string[]; superuser: boolean; authenticated: boolean }> {
    return this.consoleApi('GET', '/my-roles');
  }

  private async consoleApi<T>(method: string, path: string, body?: unknown, raw?: RawBody): Promise<T> {
    const token = await this.auth.accessToken();
    const headers: Record<string, string> = {};
    if (raw) {
      headers['content-type'] = raw.contentType;
      headers['x-filename'] = encodeURIComponent(raw.filename);
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${this.config.consoleUrl}/platform/projects/${this.config.projectRef}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : raw ? (body as Blob) : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await errorText(res));
    return (await res.json()) as T;
  }

  private callFunction<T>(functionKey: string, params: unknown): Promise<T> {
    return this.requestFunction<T>('POST', `/functions/${functionKey}/execute`, params);
  }

  private async invokeFunction<T>(functionKey: string, params: Record<string, unknown>) {
    const result = await this.callFunction<Record<string, unknown>>(functionKey, params);
    if (result.ok === false || (typeof result.error === 'string' && result.error)) {
      throw new Error(String(result.reason ?? result.message ?? result.error ?? 'Operation failed'));
    }
    return result as T & { message?: string };
  }

  private async requestFunction<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.auth.computeToken();
    const headers: Record<string, string> = { 'x-project-ref': this.config.projectRef };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${this.config.functionsUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await errorText(res));
    return (await res.json()) as T;
  }
}
