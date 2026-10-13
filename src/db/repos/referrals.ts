/**
 * ریپازیتوری کانبان ارجاع — واحدهای سازمانی و تاریخچه ارجاع‌ها.
 * ستون‌های کانبان بر اساس واحدهای سازمانی ساخته می‌شوند و هر پرونده
 * می‌تواند میان واحدها/همکاران ارجاع داده شود.
 */
import { all, get, run, nowIso } from "@/db/client";
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
  from_staff_id: string | null;
  from_unit: string | null;
  to_staff_id: string | null;
  to_unit: string;
  kind: ReferralKind;
  reason: string | null;
  service_key: string | null;
  service_name: string | null;
  depth: number;
  at: string;
  created_at: string;
}

export function listReferralsForCase(caseId: string): ReferralRow[] {
  return all<ReferralRow>("SELECT * FROM referrals WHERE case_id = ? ORDER BY at ASC, depth ASC", [caseId]);
}

export function latestReferralForCase(caseId: string): ReferralRow | null {
  return get<ReferralRow>(
    "SELECT * FROM referrals WHERE case_id = ? ORDER BY at DESC, depth DESC LIMIT 1",
    [caseId],
  );
}

export function recordReferral(input: {
  caseId: string;
  fromStaffId?: string | null;
  fromUnit?: string | null;
  toStaffId?: string | null;
  toUnit: string;
  kind: ReferralKind;
  reason?: string | null;
  serviceKey?: string | null;
  serviceName?: string | null;
}): ReferralRow {
  const existing = listReferralsForCase(input.caseId).length;
  const now = nowIso();
  const id = newId("ref");
  run(
    `INSERT INTO referrals (id, case_id, from_staff_id, from_unit, to_staff_id, to_unit, kind, reason, service_key, service_name, depth, at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.caseId,
      input.fromStaffId ?? null,
      input.fromUnit ?? null,
      input.toStaffId ?? null,
      input.toUnit,
      input.kind,
      input.reason ?? null,
      input.serviceKey ?? null,
      input.serviceName ?? null,
      existing + 1,
      now,
      now,
    ],
  );
  return get<ReferralRow>("SELECT * FROM referrals WHERE id = ?", [id])!;
}

/* ── به‌روزرسانی وضعیت کانبان و مسئول ───────────────────────────────── */

export function setKanbanStatus(caseId: string, status: string): void {
  run("UPDATE cases SET kanban_status = ?, updated_at = ? WHERE id = ?", [status, nowIso(), caseId]);
}

export function assignCaseToStaff(caseId: string, staffId: string | null): void {
  run("UPDATE cases SET assigned_staff_id = ?, updated_at = ? WHERE id = ?", [staffId, nowIso(), caseId]);
}
