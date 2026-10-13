/**
 * ریپازیتوری زیرساخت: تنظیمات، تعریف‌های گردش‌کار، حسابرسی، اعلان، سینک، وب‌هوک.
 */
import { all, get, jsonParse, nowIso, run } from "@/db/client";
import { newId } from "@/lib/ids";

/* ── تنظیمات ──────────────────────────────────────────────────────── */

export function getSetting<T>(key: string, fallback: T): T {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  if (!row) return fallback;
  return jsonParse<T>(row.value, fallback);
}

export function setSetting(key: string, value: unknown): void {
  const raw = JSON.stringify(value ?? null);
  run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, raw, nowIso()],
  );
}

export function allSettings(): Record<string, unknown> {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const out: Record<string, unknown> = {};
  for (const row of rows) out[row.key] = jsonParse(row.value, null);
  return out;
}

/* ── تعریف‌های گردش‌کار ───────────────────────────────────────────── */

export interface WorkflowDefinitionRow {
  id: string;
  key: string;
  version: number;
  name: string;
  definition: string;
  active: number;
  created_at: string;
  activated_at: string | null;
}

export function upsertWorkflowDefinition(def: { key: string; version: number; name: string; definition: unknown }): void {
  const existing = get<WorkflowDefinitionRow>(
    "SELECT * FROM workflow_definitions WHERE key = ? AND version = ?",
    [def.key, def.version],
  );
  const raw = JSON.stringify(def.definition);
  if (existing) {
    run("UPDATE workflow_definitions SET name = ?, definition = ? WHERE id = ?", [def.name, raw, existing.id]);
    return;
  }
  run(
    `INSERT INTO workflow_definitions (id, key, version, name, definition, active, created_at, activated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    [newId("wf"), def.key, def.version, def.name, raw, nowIso(), nowIso()],
  );
}

export function listWorkflows(): WorkflowDefinitionRow[] {
  return all<WorkflowDefinitionRow>("SELECT * FROM workflow_definitions ORDER BY key, version DESC");
}

export function getActiveWorkflow(key: string): WorkflowDefinitionRow | null {
  return (
    get<WorkflowDefinitionRow>(
      "SELECT * FROM workflow_definitions WHERE key = ? AND active = 1 ORDER BY version DESC LIMIT 1",
      [key],
    ) ?? null
  );
}

export function setWorkflowActive(id: string, active: boolean): void {
  const row = get<WorkflowDefinitionRow>("SELECT * FROM workflow_definitions WHERE id = ?", [id]);
  if (!row) return;
  if (active) {
    run("UPDATE workflow_definitions SET active = 0 WHERE key = ?", [row.key]);
    run("UPDATE workflow_definitions SET active = 1, activated_at = ? WHERE id = ?", [nowIso(), id]);
  } else {
    run("UPDATE workflow_definitions SET active = 0 WHERE id = ?", [id]);
  }
}

/* ── حسابرسی ─────────────────────────────────────────────────────── */

export interface AuditRow {
  id: string;
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  detail: string | null;
  ip: string | null;
  at: string;
}

export function writeAudit(entry: {
  actorType: string;
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  detail?: unknown;
  ip?: string | null;
}): void {
  run(
    `INSERT INTO audit_log (id, actor_type, actor_id, actor_name, action, entity_type, entity_id, detail, ip, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("aud"),
      entry.actorType,
      entry.actorId ?? null,
      entry.actorName ?? null,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.detail === undefined ? null : JSON.stringify(entry.detail),
      entry.ip ?? null,
      nowIso(),
    ],
  );
}

export function listAudit(limit = 100, offset = 0): AuditRow[] {
  return all<AuditRow>("SELECT * FROM audit_log ORDER BY at DESC LIMIT ? OFFSET ?", [limit, offset]);
}

/* ── اعلان‌ها ────────────────────────────────────────────────────── */

export interface NotificationRow {
  id: string;
  channel: string;
  template: string;
  to_user_id: string | null;
  to_address: string | null;
  to_staff_id: string | null;
  case_id: string | null;
  body: string;
  status: string;
  kind: string | null;
  link: string | null;
  read_at: string | null;
  dedupe_key: string | null;
  error: string | null;
  provider: string | null;
  sent_at: string | null;
  created_at: string;
}

export function insertNotification(row: {
  channel: string;
  template: string;
  toUserId?: string | null;
  toAddress?: string | null;
  caseId?: string | null;
  body: string;
}): string {
  const id = newId("ntf");
  run(
    `INSERT INTO notifications (id, channel, template, to_user_id, to_address, case_id, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    [id, row.channel, row.template, row.toUserId ?? null, row.toAddress ?? null, row.caseId ?? null, row.body, nowIso()],
  );
  return id;
}

export function markNotification(id: string, status: "sent" | "failed", provider?: string, error?: string): void {
  run("UPDATE notifications SET status = ?, provider = ?, error = ?, sent_at = ? WHERE id = ?", [
    status,
    provider ?? null,
    error ?? null,
    status === "sent" ? nowIso() : null,
    id,
  ]);
}

/**
 * گزارش پیام‌های بیرونی (پیامک/ایمیل به کاربر یا مشاور).
 * اعلان‌های داخلی کارمندان (channel='inapp') عمداً در این فهرست نمی‌آیند تا
 * محتوای داخلی هرگز در گزارش‌ها یا پاسخ‌های مشتری دیده نشود.
 */
export function listNotifications(caseId?: string, limit = 100, opts: { includeInternal?: boolean } = {}): NotificationRow[] {
  const filter = opts.includeInternal ? "" : " AND (channel != 'inapp' OR channel IS NULL) AND to_staff_id IS NULL";
  if (caseId) {
    return all<NotificationRow>(
      `SELECT * FROM notifications WHERE case_id = ?${filter} ORDER BY created_at DESC LIMIT ?`,
      [caseId, limit],
    );
  }
  return all<NotificationRow>(`SELECT * FROM notifications WHERE 1 = 1${filter} ORDER BY created_at DESC LIMIT ?`, [limit]);
}

/* ── صندوق اعلان داخلی (کارمندان) ──────────────────────────────────
 * همان جدول `notifications` با channel='inapp' و status='sent'؛ گیرنده داخلی در
 * ستون to_staff_id است. `dedupe_key` یگانه جلوی اعلان تکراری در درخواست/اجرای
 * تکراری (مثلاً زمان‌بند سررسید) را می‌گیرد.
 */

export interface StaffInboxRow {
  id: string;
  channel: string;
  template: string;
  kind: string | null;
  to_staff_id: string | null;
  case_id: string | null;
  body: string;
  link: string | null;
  read_at: string | null;
  status: string;
  dedupe_key: string | null;
  created_at: string;
}

/**
 * ثبت اعلان داخلی. اگر `dedupeKey` تکراری باشد، اعلان تازه ساخته نمی‌شود
 * و id ردیف موجود برگردانده می‌شود (عملیات idempotent).
 */
export function insertInboxNotification(row: {
  staffId: string;
  kind: string;
  template: string;
  body: string;
  caseId?: string | null;
  link?: string | null;
  dedupeKey?: string | null;
  actorName?: string | null;
}): { id: string; created: boolean } {
  if (row.dedupeKey) {
    const existing = get<{ id: string }>("SELECT id FROM notifications WHERE dedupe_key = ?", [row.dedupeKey]);
    if (existing) return { id: existing.id, created: false };
  }
  const id = newId("ntf");
  try {
    run(
      `INSERT INTO notifications (id, channel, template, to_user_id, to_address, to_staff_id, case_id, body, status, kind, link, dedupe_key, sent_at, created_at)
       VALUES (?, 'inapp', ?, NULL, NULL, ?, ?, ?, 'sent', ?, ?, ?, ?, ?)`,
      [
        id,
        row.template,
        row.staffId,
        row.caseId ?? null,
        row.body,
        row.kind,
        row.link ?? null,
        row.dedupeKey ?? null,
        nowIso(),
        nowIso(),
      ],
    );
  } catch (err) {
    // شرط یگانگی dedupe_key در درخواست هم‌زمان → همان ردیف موجود برگردانده می‌شود
    if (row.dedupeKey) {
      const existing = get<{ id: string }>("SELECT id FROM notifications WHERE dedupe_key = ?", [row.dedupeKey]);
      if (existing) return { id: existing.id, created: false };
    }
    throw err;
  }
  return { id, created: true };
}

export function listInbox(
  staffId: string,
  opts: { unreadOnly?: boolean; kind?: string; caseId?: string; limit?: number; offset?: number } = {},
): StaffInboxRow[] {
  const clauses = ["to_staff_id = ?", "channel = 'inapp'"];
  const params: Array<string | number> = [staffId];
  if (opts.unreadOnly) clauses.push("read_at IS NULL");
  if (opts.kind) {
    clauses.push("kind = ?");
    params.push(opts.kind);
  }
  if (opts.caseId) {
    clauses.push("case_id = ?");
    params.push(opts.caseId);
  }
  params.push(opts.limit ?? 50, opts.offset ?? 0);
  return all<StaffInboxRow>(
    `SELECT id, channel, template, kind, to_staff_id, case_id, body, link, read_at, status, dedupe_key, created_at
     FROM notifications WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    params,
  );
}

export function countUnreadInbox(staffId: string, kind?: string): number {
  const params: string[] = [staffId];
  let extra = "";
  if (kind) {
    extra = " AND kind = ?";
    params.push(kind);
  }
  return (
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM notifications WHERE to_staff_id = ? AND channel = 'inapp' AND read_at IS NULL${extra}`,
      params,
    )?.n ?? 0
  );
}

/** علامت‌گذاری یک اعلان به‌عنوان خوانده‌شده (فقط برای مالک همان اعلان) */
export function markInboxRead(staffId: string, id: string): boolean {
  const result = run(
    "UPDATE notifications SET read_at = ? WHERE id = ? AND to_staff_id = ? AND read_at IS NULL",
    [nowIso(), id, staffId],
  );
  if (result.changes > 0) return true;
  const mine = get<{ id: string }>("SELECT id FROM notifications WHERE id = ? AND to_staff_id = ?", [id, staffId]);
  return Boolean(mine);
}

export function markAllInboxRead(staffId: string, kind?: string): number {
  const params: string[] = [nowIso(), staffId];
  let extra = "";
  if (kind) {
    extra = " AND kind = ?";
    params.push(kind);
  }
  return run(
    `UPDATE notifications SET read_at = ? WHERE to_staff_id = ? AND channel = 'inapp' AND read_at IS NULL${extra}`,
    params,
  ).changes;
}

/** پاک‌سازی اعلان‌های خوانده‌شده قدیمی (نگهداری) */
export function purgeReadInbox(staffId: string, olderThanIso: string): number {
  return run("DELETE FROM notifications WHERE to_staff_id = ? AND channel = 'inapp' AND read_at IS NOT NULL AND read_at < ?", [
    staffId,
    olderThanIso,
  ]).changes;
}

/* ── سینک ────────────────────────────────────────────────────────── */

export interface SyncLogRow {
  id: string;
  direction: string;
  channel: string;
  entity_type: string | null;
  source: string | null;
  idempotency_key: string | null;
  item_count: number;
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  status: string;
  detail: string | null;
  actor: string | null;
  duration_ms: number | null;
  at: string;
}

export function insertSyncLog(entry: {
  direction: "in" | "out";
  channel: "push" | "pull" | "webhook";
  entityType?: string | null;
  source?: string | null;
  idempotencyKey?: string | null;
  itemCount?: number;
  created?: number;
  updated?: number;
  unchanged?: number;
  rejected?: number;
  status?: "ok" | "partial" | "failed";
  detail?: unknown;
  actor?: string | null;
  durationMs?: number | null;
}): string {
  const id = newId("sync");
  run(
    `INSERT INTO sync_log (id, direction, channel, entity_type, source, idempotency_key, item_count, created, updated,
       unchanged, rejected, status, detail, actor, duration_ms, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.direction,
      entry.channel,
      entry.entityType ?? null,
      entry.source ?? null,
      entry.idempotencyKey ?? null,
      entry.itemCount ?? 0,
      entry.created ?? 0,
      entry.updated ?? 0,
      entry.unchanged ?? 0,
      entry.rejected ?? 0,
      entry.status ?? "ok",
      entry.detail === undefined ? null : JSON.stringify(entry.detail),
      entry.actor ?? null,
      entry.durationMs ?? null,
      nowIso(),
    ],
  );
  return id;
}

export function insertSyncItemResult(entry: {
  syncLogId: string;
  entityType: string;
  externalId?: string | null;
  action: string;
  reason?: string | null;
}): void {
  run(
    `INSERT INTO sync_item_results (id, sync_log_id, entity_type, external_id, action, reason, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId("sitem"), entry.syncLogId, entry.entityType, entry.externalId ?? null, entry.action, entry.reason ?? null, nowIso()],
  );
}

export function listSyncLog(limit = 100): SyncLogRow[] {
  return all<SyncLogRow>("SELECT * FROM sync_log ORDER BY at DESC LIMIT ?", [limit]);
}

export function listSyncItems(syncLogId: string, limit = 200): Array<{ entity_type: string; external_id: string | null; action: string; reason: string | null }> {
  return all("SELECT entity_type, external_id, action, reason FROM sync_item_results WHERE sync_log_id = ? LIMIT ?", [
    syncLogId,
    limit,
  ]);
}

export function getPullCursor(entityType: string): { lastPulledAt: string | null; lastCursor: string | null } {
  const row = get<{ last_pulled_at: string | null; last_cursor: string | null }>(
    "SELECT last_pulled_at, last_cursor FROM pull_cursors WHERE entity_type = ?",
    [entityType],
  );
  return { lastPulledAt: row?.last_pulled_at ?? null, lastCursor: row?.last_cursor ?? null };
}

export function setPullCursor(entityType: string, lastPulledAt: string, lastCursor?: string | null): void {
  run(
    `INSERT INTO pull_cursors (id, entity_type, last_pulled_at, last_cursor, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(entity_type) DO UPDATE SET last_pulled_at = excluded.last_pulled_at,
       last_cursor = excluded.last_cursor, updated_at = excluded.updated_at`,
    [newId("cur"), entityType, lastPulledAt, lastCursor ?? null, nowIso()],
  );
}

/* ── وب‌هوک خروجی ────────────────────────────────────────────────── */

export interface WebhookRow {
  id: string;
  event: string;
  case_id: string | null;
  payload: string;
  target_url: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export function enqueueWebhook(event: string, payload: unknown, targetUrl: string | null, caseId?: string | null): string {
  const id = newId("wh");
  const now = nowIso();
  run(
    `INSERT INTO outbound_webhooks (id, event, case_id, payload, target_url, status, attempts, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
    [id, event, caseId ?? null, JSON.stringify(payload), targetUrl, now, now, now],
  );
  return id;
}

export function dueWebhooks(limit = 20): WebhookRow[] {
  return all<WebhookRow>(
    `SELECT * FROM outbound_webhooks
     WHERE status IN ('pending', 'failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY created_at ASC LIMIT ?`,
    [nowIso(), limit],
  );
}

export function markWebhook(id: string, outcome: { ok: boolean; error?: string; attempts: number; backoffMinutes?: number }): void {
  const now = nowIso();
  if (outcome.ok) {
    run("UPDATE outbound_webhooks SET status = 'delivered', attempts = ?, delivered_at = ?, last_error = NULL, updated_at = ? WHERE id = ?", [
      outcome.attempts,
      now,
      now,
      id,
    ]);
    return;
  }
  const dead = outcome.attempts >= 5;
  const next = new Date(Date.now() + (outcome.backoffMinutes ?? 5) * 60_000).toISOString();
  run(
    "UPDATE outbound_webhooks SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?",
    [dead ? "dead" : "failed", outcome.attempts, outcome.error ?? null, dead ? null : next, now, id],
  );
}

export function listWebhooks(limit = 100): WebhookRow[] {
  return all<WebhookRow>("SELECT * FROM outbound_webhooks ORDER BY created_at DESC LIMIT ?", [limit]);
}

/** بازگشت وب‌هوک مرده به صف برای تلاش دوباره (attempts صفر می‌شود) */
export function retryWebhook(id: string): void {
  const now = nowIso();
  run(
    "UPDATE outbound_webhooks SET status = 'pending', attempts = 0, next_attempt_at = ?, last_error = NULL, updated_at = ? WHERE id = ?",
    [now, now, id],
  );
}

/** حذف رکوردهای وب‌هوک (برای پاک‌سازی موارد مرده/قدیمی) */
export function deleteWebhooks(ids: string[]): number {
  if (!ids.length) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  run(`DELETE FROM outbound_webhooks WHERE id IN (${placeholders})`, ids);
  return ids.length;
}

/* ── Idempotency ─────────────────────────────────────────────────── */

export function getIdempotentResponse(key: string): { status: number; response: string | null } | null {
  const row = get<{ status: number; response: string | null; expires_at: string | null }>(
    "SELECT status, response, expires_at FROM idempotency_keys WHERE key = ?",
    [key],
  );
  if (!row) return null;
  if (row.expires_at && row.expires_at < nowIso()) return null;
  return { status: row.status, response: row.response };
}

export function saveIdempotentResponse(key: string, scope: string, status: number, response: unknown, ttlHours = 48): void {
  const expires = new Date(Date.now() + ttlHours * 3_600_000).toISOString();
  run(
    `INSERT INTO idempotency_keys (key, scope, status, response, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET status = excluded.status, response = excluded.response, expires_at = excluded.expires_at`,
    [key, scope, status, JSON.stringify(response ?? null), nowIso(), expires],
  );
}
