/**
 * ریپازیتوری کانبان عملیات — واحدهای سازمانی، تاریخچه کامل ارجاع‌ها و کوئری تخته.
 * ستون‌های کانبان بر اساس واحدهای سازمانی ساخته می‌شوند و هر پرونده
 * می‌تواند میان واحدها/همکاران ارجاع داده شود.
 *
 * نکته: `actor_*` (عامل ارجاع‌دهنده) با `from_staff_id` (مسئول قبلی) یکی نیست؛
 * در ارجاع از صف واحد، مسئول قبلی می‌تواند خالی باشد در حالی که عامل مشخص است.
 */
import { all, get, nowIso, run } from "@/db/client";
import { newId } from "@/lib/ids";

/* ── واحدهای سازمانی ──────────────────────────────────────────────── */

export interface OrgUnitRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function listOrgUnits(): OrgUnitRow[] {
  return all<OrgUnitRow>("SELECT * FROM org_units ORDER BY sort_order, name");
}

export function getOrgUnit(key: string): OrgUnitRow | null {
  return get<OrgUnitRow>("SELECT * FROM org_units WHERE key = ?", [key]);
}

export function findOrgUnitById(id: string): OrgUnitRow | null {
  return get<OrgUnitRow>("SELECT * FROM org_units WHERE id = ?", [id]);
}

export function createOrgUnit(input: { key: string; name: string; description?: string | null; sortOrder?: number }): string {
  const id = newId("org");
  const now = nowIso();
  run(
    `INSERT INTO org_units (id, key, name, description, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.key, input.name, input.description ?? null, input.sortOrder ?? 0, now, now],
  );
  return id;
}

export function updateOrgUnit(id: string, patch: { key?: string; name?: string; description?: string | null; sortOrder?: number }): void {
  const current = findOrgUnitById(id);
  if (!current) return;
  run(
    `UPDATE org_units SET key = ?, name = ?, description = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
    [
      patch.key ?? current.key,
      patch.name ?? current.name,
      patch.description === undefined ? current.description : patch.description,
      patch.sortOrder ?? current.sort_order,
      nowIso(),
      id,
    ],
  );
}

export function deleteOrgUnit(id: string): void {
  run("DELETE FROM org_units WHERE id = ?", [id]);
}

export function countReferralsForUnit(unitKey: string): number {
  const row = get<{ n: number }>("SELECT COUNT(*) AS n FROM referrals WHERE to_unit = ? OR from_unit = ?", [unitKey, unitKey]);
  return row?.n ?? 0;
}

/* ── تاریخچه ارجاع ────────────────────────────────────────────────── */

export type ReferralKind = "colleague" | "unit";

export interface ReferralRow {
  id: string;
  case_id: string;
  entity_type: string | null;
  from_staff_id: string | null;
  from_unit: string | null;
  to_staff_id: string | null;
  to_unit: string;
  kind: ReferralKind;
  reason: string | null;
  description: string | null;
  expected_output: string | null;
  priority: string | null;
  due_at: string | null;
  status_before: string | null;
  status_after: string | null;
  result: string | null;
  note: string | null;
  outcome_note: string | null;
  actor_type: string | null;
  actor_id: string | null;
  actor_name: string | null;
  service_key: string | null;
  service_name: string | null;
  depth: number;
  idempotency_key: string | null;
  at: string;
  created_at: string;
  updated_at: string | null;
}

export function listReferralsForCase(caseId: string): ReferralRow[] {
  return all<ReferralRow>("SELECT * FROM referrals WHERE case_id = ? ORDER BY at ASC, depth ASC", [caseId]);
}

/** همه ارجاع‌های چند پرونده با یک کوئری (پرهیز از N+1 در ساخت تخته) */
export function listReferralsForCases(caseIds: string[]): ReferralRow[] {
  if (!caseIds.length) return [];
  const placeholders = caseIds.map(() => "?").join(", ");
  return all<ReferralRow>(
    `SELECT * FROM referrals WHERE case_id IN (${placeholders}) ORDER BY case_id, at ASC, depth ASC`,
    caseIds,
  );
}

export function latestReferralForCase(caseId: string): ReferralRow | null {
  return get<ReferralRow>(
    "SELECT * FROM referrals WHERE case_id = ? ORDER BY at DESC, depth DESC LIMIT 1",
    [caseId],
  );
}

export function findReferralById(id: string): ReferralRow | null {
  return get<ReferralRow>("SELECT * FROM referrals WHERE id = ?", [id]);
}

export function findReferralByIdempotencyKey(caseId: string, key: string): ReferralRow | null {
  return get<ReferralRow>("SELECT * FROM referrals WHERE case_id = ? AND idempotency_key = ?", [caseId, key]);
}

export interface RecordReferralInput {
  caseId: string;
  entityType?: string | null;
  fromStaffId?: string | null;
  fromUnit?: string | null;
  toStaffId?: string | null;
  toUnit: string;
  kind: ReferralKind;
  reason?: string | null;
  description?: string | null;
  expectedOutput?: string | null;
  note?: string | null;
  priority?: string | null;
  dueAt?: string | null;
  statusBefore?: string | null;
  statusAfter?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  serviceKey?: string | null;
  serviceName?: string | null;
  idempotencyKey?: string | null;
}

export function recordReferral(input: RecordReferralInput): ReferralRow {
  if (input.idempotencyKey) {
    const existing = findReferralByIdempotencyKey(input.caseId, input.idempotencyKey);
    if (existing) return existing;
  }
  const existingCount = get<{ n: number }>("SELECT COUNT(*) AS n FROM referrals WHERE case_id = ?", [input.caseId])?.n ?? 0;
  const now = nowIso();
  const id = newId("ref");
  run(
    `INSERT INTO referrals (id, case_id, entity_type, from_staff_id, from_unit, to_staff_id, to_unit, kind, reason,
       description, expected_output, note, priority, due_at, status_before, status_after, actor_type, actor_id, actor_name,
       service_key, service_name, depth, idempotency_key, at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.caseId,
      input.entityType ?? "case",
      input.fromStaffId ?? null,
      input.fromUnit ?? null,
      input.toStaffId ?? null,
      input.toUnit,
      input.kind,
      input.reason ?? null,
      input.description ?? null,
      input.expectedOutput ?? null,
      input.note ?? null,
      input.priority ?? null,
      input.dueAt ?? null,
      input.statusBefore ?? null,
      input.statusAfter ?? null,
      input.actorType ?? null,
      input.actorId ?? null,
      input.actorName ?? null,
      input.serviceKey ?? null,
      input.serviceName ?? null,
      existingCount + 1,
      input.idempotencyKey ?? null,
      now,
      now,
      now,
    ],
  );
  return get<ReferralRow>("SELECT * FROM referrals WHERE id = ?", [id])!;
}

/** ثبت نتیجه/علت برگشت روی آخرین ارجاع (سابقه بازنویسی نمی‌شود؛ فقط تکمیل می‌شود) */
export function completeReferral(
  referralId: string,
  patch: { result?: string | null; outcomeNote?: string | null; statusAfter?: string | null },
): void {
  const current = findReferralById(referralId);
  if (!current) return;
  run(
    `UPDATE referrals SET result = ?, outcome_note = ?, status_after = ?, updated_at = ? WHERE id = ?`,
    [
      patch.result === undefined ? current.result : patch.result,
      patch.outcomeNote === undefined ? current.outcome_note : patch.outcomeNote,
      patch.statusAfter === undefined ? current.status_after : patch.statusAfter,
      nowIso(),
      referralId,
    ],
  );
}

/* ── فیلتر تخته کانبان (سمت سرور) ─────────────────────────────────── */

export interface BoardCaseRow {
  case_id: string;
  code: string | null;
  title: string | null;
  service_key: string;
  workflow_key: string;
  status: string;
  priority: string;
  state: string;
  due_at: string | null;
  opened_at: string;
  created_at: string;
  assigned_staff_id: string | null;
  kanban_status: string;
  current_unit: string | null;
  owner_unit: string | null;
  last_referral_at: string | null;
  last_referral_id: string | null;
}

export interface BoardFilter {
  serviceKey?: string;
  unitKey?: string;
  staffId?: string;
  kanbanStatus?: string;
  priority?: string;
  due?: "overdue" | "today" | "week" | "none";
  search?: string;
  unassigned?: boolean;
  limit?: number;
  includeClosed?: boolean;
}

/**
 * کارت‌های تخته: پرونده‌های باز با واحد جاری و آخرین ارجاع.
 * واحد جاری = واحد آخرین ارجاع؛ اگر ارجاعی نباشد = واحد مسئول فعلی.
 */
export function listBoardCases(filter: BoardFilter = {}): BoardCaseRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (!filter.includeClosed) clauses.push("c.status = 'open'");
  if (filter.serviceKey) {
    clauses.push("c.service_key = ?");
    params.push(filter.serviceKey);
  }
  if (filter.priority) {
    clauses.push("c.priority = ?");
    params.push(filter.priority);
  }
  if (filter.kanbanStatus) {
    clauses.push("c.kanban_status = ?");
    params.push(filter.kanbanStatus);
  }
  if (filter.staffId) {
    clauses.push("c.assigned_staff_id = ?");
    params.push(filter.staffId);
  }
  if (filter.unassigned) clauses.push("c.assigned_staff_id IS NULL");
  if (filter.search) {
    clauses.push("(c.code LIKE ? OR c.title LIKE ? OR c.id LIKE ? OR c.external_id LIKE ?)");
    const like = `%${filter.search}%`;
    params.push(like, like, like, like);
  }
  if (filter.unitKey) {
    clauses.push("COALESCE(lr.to_unit, os.org_unit) = ?");
    params.push(filter.unitKey);
  }
  if (filter.due === "overdue") {
    clauses.push("c.due_at IS NOT NULL AND c.due_at < ?");
    params.push(nowIso());
  }
  if (filter.due === "today") {
    clauses.push("c.due_at IS NOT NULL AND c.due_at < ?");
    params.push(new Date(Date.now() + 24 * 3600_000).toISOString());
  }
  if (filter.due === "week") {
    clauses.push("c.due_at IS NOT NULL AND c.due_at < ?");
    params.push(new Date(Date.now() + 7 * 24 * 3600_000).toISOString());
  }
  if (filter.due === "none") clauses.push("c.due_at IS NULL");

  const sql = `
    SELECT
      c.id                    AS case_id,
      c.code                  AS code,
      c.title                 AS title,
      c.service_key           AS service_key,
      c.workflow_key          AS workflow_key,
      c.status                AS status,
      c.priority              AS priority,
      c.state                 AS state,
      c.due_at                AS due_at,
      c.opened_at             AS opened_at,
      c.created_at            AS created_at,
      c.assigned_staff_id     AS assigned_staff_id,
      c.kanban_status         AS kanban_status,
      COALESCE(lr.to_unit, os.org_unit) AS current_unit,
      os.org_unit             AS owner_unit,
      lr.at                   AS last_referral_at,
      lr.id                   AS last_referral_id
    FROM cases c
    LEFT JOIN (
      SELECT r.* FROM referrals r
      WHERE r.depth = (SELECT MAX(r2.depth) FROM referrals r2 WHERE r2.case_id = r.case_id)
    ) lr ON lr.case_id = c.id
    LEFT JOIN staff os ON os.id = c.assigned_staff_id
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY
      CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      COALESCE(c.due_at, c.created_at) ASC
    LIMIT ?
  `;
  params.push(filter.limit ?? 300);

  return all<BoardCaseRow>(sql, params);
}

/** شمار کارت‌های عقب‌افتاده (سررسید گذشته و عملیات بسته‌نشده) */
export function countOverdue(): number {
  return (
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM cases
       WHERE status = 'open' AND due_at IS NOT NULL AND due_at < ?
         AND kanban_status NOT IN ('done', 'cancelled')`,
      [nowIso()],
    )?.n ?? 0
  );
}

/** شناسه کارکنان فعال یک واحد (برای اعلان صف واحد) */
export function unitStaffIds(unitKey: string): string[] {
  return all<{ id: string }>("SELECT id FROM staff WHERE active = 1 AND org_unit = ?", [unitKey]).map((r) => r.id);
}

/* ── به‌روزرسانی وضعیت کانبان و مسئول ───────────────────────────────── */

export const KANBAN_STATUSES = ["new", "in_review", "waiting_info", "returned_correction", "done", "cancelled"] as const;
export type KanbanStatus = (typeof KANBAN_STATUSES)[number];

export function setKanbanStatus(caseId: string, status: string): void {
  run("UPDATE cases SET kanban_status = ?, updated_at = ? WHERE id = ?", [status, nowIso(), caseId]);
}

export function assignCaseToStaff(caseId: string, staffId: string | null): void {
  run("UPDATE cases SET assigned_staff_id = ?, updated_at = ? WHERE id = ?", [staffId, nowIso(), caseId]);
}
