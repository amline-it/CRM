/**
 * لایه سرویس کانبان ارجاع درون‌سازمانی.
 *
 * پیاده‌سازی منطق فلوچارت:
 *   ویزارد خدمت → باکس اقدام سریع → نوع ارجاع (همکار/واحد)
 *   → تشخیص واحد سازمانی کارمند → اعتبارسنجی دسترسی → ثبت ارجاع + تاریخچه
 *   → به‌روزرسانی مسئول و وضعیت → انتقال کارت به ستون واحد مقصد → نمایش مسیر
 *   → اقدام مسئول جدید (رسیدگی/اطلاعات/اصلاح/ارجاع مجدد/اتمام) → ثبت رویداد.
 */
import { AppError } from "@/lib/errors";
import { KANBAN_ACTION_LABELS } from "@/lib/fa-labels";
import { nowIso } from "@/db/client";
import * as Cases from "@/db/repos/cases";
import * as People from "@/db/repos/people";
import * as Catalog from "@/db/repos/catalog";
import * as Platform from "@/db/repos/platform";
import * as Referrals from "@/db/repos/referrals";
import * as Svc from "@/domain/service/case-service";
import type { ActorContext } from "@/domain/engine/types";

export type KanbanStatus = "new" | "in_review" | "waiting_info" | "returned_correction" | "done";
export type KanbanAction = "start_review" | "need_info" | "return_correction" | "rerefer" | "complete";

const ACTION_TO_STATUS: Record<Exclude<KanbanAction, "rerefer">, KanbanStatus> = {
  start_review: "in_review",
  need_info: "waiting_info",
  return_correction: "returned_correction",
  complete: "done",
};

/* ── کمکی: واحد جاری و دسترسی ──────────────────────────────────────── */

function staffUnit(staffId: string | null): string | null {
  if (!staffId) return null;
  return People.findStaffById(staffId)?.org_unit ?? null;
}

export function currentUnitOfCase(
  caseRow: Cases.CaseRow,
  latestRef: Referrals.ReferralRow | null,
): { unitKey: string; unitName: string } | null {
  const key = latestRef ? latestRef.to_unit : staffUnit(caseRow.assigned_staff_id);
  if (!key) return null;
  const unit = Referrals.getOrgUnit(key);
  return { unitKey: key, unitName: unit?.name ?? key };
}

export function canActOnCase(caseRow: Cases.CaseRow, latestRef: Referrals.ReferralRow | null, actor: ActorContext): boolean {
  if (actor.type === "admin") return true;
  if (actor.id && actor.id === caseRow.assigned_staff_id) return true;
  const unit = currentUnitOfCase(caseRow, latestRef)?.unitKey ?? null;
  if (actor.id && unit) {
    const me = People.findStaffById(actor.id);
    if (me?.org_unit && me.org_unit === unit) return true;
  }
  return false;
}

/* ── ارجاع (باکس اقدام سریع) ───────────────────────────────────────── */

export interface ReferInput {
  caseId: string;
  actor: ActorContext;
  kind: "colleague" | "unit";
  toStaffId?: string | null;
  toUnit?: string | null;
  reason?: string | null;
  idempotencyKey?: string | null;
}

export interface ReferResult {
  caseId: string;
  referralId: string;
  toUnit: string;
  toStaffId: string | null;
}

export function referCase(input: ReferInput): ReferResult {
  const caseRow = Cases.findCaseById(input.caseId);
  if (!caseRow) throw new AppError("NOT_FOUND", `پرونده ${input.caseId} یافت نشد`);
  if (caseRow.status === "closed") throw new AppError("CONFLICT", "پرونده بسته شده و قابل ارجاع نیست");

  const latestRef = Referrals.latestReferralForCase(input.caseId);
  if (!canActOnCase(caseRow, latestRef, input.actor)) {
    throw new AppError("FORBIDDEN", "شما مسئول این پرونده نیستید و دسترسی ارجاع ندارید");
  }

  let toStaffId: string | null = null;
  let toUnit: string;
  if (input.kind === "colleague") {
    if (!input.toStaffId) throw new AppError("VALIDATION", "کارمند مقصد انتخاب نشده است");
    const target = People.findStaffById(input.toStaffId);
    if (!target || !target.active) throw new AppError("NOT_FOUND", "کارمند مقصد یافت نشد یا غیرفعال است");
    if (!target.org_unit) {
      throw new AppError(
        "VALIDATION",
        `کارمند «${target.full_name}» واحد سازمانی ندارد؛ ابتدا واحد او را در بخش کارشناسان تنظیم کنید`,
      );
    }
    toUnit = target.org_unit;
    toStaffId = target.id;
  } else {
    if (!input.toUnit) throw new AppError("VALIDATION", "واحد مقصد انتخاب نشده است");
    const unit = Referrals.getOrgUnit(input.toUnit);
    if (!unit) throw new AppError("NOT_FOUND", "واحد مقصد یافت نشد");
    toUnit = unit.key;
    toStaffId = null;
  }

  const fromUnit = currentUnitOfCase(caseRow, latestRef)?.unitKey ?? null;
  const fromStaffId = caseRow.assigned_staff_id;
  const service = Catalog.getServiceByKey(caseRow.service_key);
  const now = nowIso();

  // ثبت ارجاع + تاریخچه (ارجاع‌دهنده، گیرنده، زمان، علت و خدمت مرتبط)
  const referral = Referrals.recordReferral({
    caseId: input.caseId,
    fromStaffId,
    fromUnit,
    toStaffId,
    toUnit,
    kind: input.kind,
    reason: input.reason ?? null,
    serviceKey: caseRow.service_key,
    serviceName: service?.name ?? caseRow.service_key,
  });

  // به‌روزرسانی مسئول و وضعیت ارجاع + انتقال کارت به ستون واحد مقصد
  Referrals.assignCaseToStaff(input.caseId, toStaffId);
  Referrals.setKanbanStatus(input.caseId, "new");
  Cases.updateCase(input.caseId, { updated_at: now });

  const toLabel =
    input.kind === "colleague"
      ? `همکار (${People.findStaffById(toStaffId!)?.full_name ?? ""})`
      : `واحد ${Referrals.getOrgUnit(toUnit)?.name ?? toUnit}`;

  Cases.insertTimelineEvent({
    caseId: input.caseId,
    kind: "referral.sent",
    title: `ارجاع به ${toLabel}`,
    body: input.reason ?? null,
    actorId: input.actor.id,
    actorName: input.actor.name,
    at: now,
    meta: { kind: input.kind, toUnit, toStaffId, depth: referral.depth },
  });

  Platform.writeAudit({
    actorType: input.actor.type,
    actorId: input.actor.id,
    actorName: input.actor.name,
    action: "referral.send",
    entityType: "case",
    entityId: input.caseId,
    detail: { kind: input.kind, toUnit, toStaffId },
  });

  return { caseId: input.caseId, referralId: referral.id, toUnit, toStaffId };
}

/* ── اقدام مسئول جدید ─────────────────────────────────────────────── */

export interface ActInput {
  caseId: string;
  actor: ActorContext;
  action: KanbanAction;
  reason?: string | null;
  kind?: "colleague" | "unit";
  toStaffId?: string | null;
  toUnit?: string | null;
}

export interface ActResult {
  caseId: string;
  kanbanStatus: KanbanStatus;
  action: KanbanAction;
}

export function actOnCard(input: ActInput): ActResult {
  const caseRow = Cases.findCaseById(input.caseId);
  if (!caseRow) throw new AppError("NOT_FOUND", `پرونده ${input.caseId} یافت نشد`);
  if (caseRow.status === "closed") throw new AppError("CONFLICT", "پرونده بسته شده است");

  const latestRef = Referrals.latestReferralForCase(input.caseId);
  if (!canActOnCase(caseRow, latestRef, input.actor)) {
    throw new AppError("FORBIDDEN", "شما مسئول این پرونده نیستید و دسترسی اقدام ندارید");
  }

  // ارجاع مجدد → همان مسیر ارجاع را طی می‌کند
  if (input.action === "rerefer") {
    referCase({
      caseId: input.caseId,
      actor: input.actor,
      kind: input.kind ?? "unit",
      toStaffId: input.toStaffId,
      toUnit: input.toUnit,
      reason: input.reason,
    });
    return { caseId: input.caseId, kanbanStatus: "new", action: "rerefer" };
  }

  const status = ACTION_TO_STATUS[input.action];
  if (!status) throw new AppError("VALIDATION", "اقدام نامشخص است");

  Referrals.setKanbanStatus(input.caseId, status);
  Cases.updateCase(input.caseId, { updated_at: nowIso() });

  const label = KANBAN_ACTION_LABELS[input.action] ?? input.action;
  Cases.insertTimelineEvent({
    caseId: input.caseId,
    kind: "referral.action",
    title: `اقدام مسئول: ${label}`,
    body: input.reason ?? null,
    actorId: input.actor.id,
    actorName: input.actor.name,
    at: nowIso(),
    meta: { action: input.action, status },
  });

  Platform.writeAudit({
    actorType: input.actor.type,
    actorId: input.actor.id,
    actorName: input.actor.name,
    action: "referral.act",
    entityType: "case",
    entityId: input.caseId,
    detail: { action: input.action, status },
  });

  return { caseId: input.caseId, kanbanStatus: status, action: input.action };
}

/* ── ایجاد کارت اولیه (ورودی ویزارد خدمت) ─────────────────────────── */

export interface CreateKanbanCardInput {
  actor: ActorContext;
  serviceKey: string;
  title: string;
  priority?: string;
}

export function createKanbanCard(input: CreateKanbanCardInput): { caseId: string } {
  const service = Catalog.getServiceByKey(input.serviceKey);
  if (!service) throw new AppError("NOT_FOUND", `خدمت «${input.serviceKey}» یافت نشد`);
  const created = Svc.createCase({
    serviceKey: input.serviceKey,
    title: input.title,
    priority: (input.priority as Cases.CaseRow["priority"]) ?? "normal",
    assignedStaffId: input.actor.id,
  });

  // ثبت ارجاع اولیه (ورود به واحد سازمانی مسئول)
  const unit = staffUnit(input.actor.id ?? null);
  if (unit) {
    Referrals.recordReferral({
      caseId: created.caseId,
      fromStaffId: input.actor.id,
      fromUnit: null,
      toStaffId: input.actor.id,
      toUnit: unit,
      kind: "unit",
      reason: "ثبت اولیه در واحد",
      serviceKey: input.serviceKey,
      serviceName: service.name,
    });
  }

  Platform.writeAudit({
    actorType: input.actor.type,
    actorId: input.actor.id,
    actorName: input.actor.name,
    action: "referral.card_create",
    entityType: "case",
    entityId: created.caseId,
    detail: { serviceKey: input.serviceKey },
  });

  return { caseId: created.caseId };
}

/* ── ساخت داده تخته کانبان ─────────────────────────────────────────── */

export interface ReferralPathNode {
  depth: number;
  fromName: string | null;
  fromUnit: string | null;
  fromUnitName: string | null;
  toName: string | null;
  toUnit: string;
  toUnitName: string | null;
  kind: "colleague" | "unit";
  reason: string | null;
  at: string;
}

export interface BoardCard {
  caseId: string;
  code: string | null;
  title: string | null;
  serviceKey: string;
  serviceName: string;
  priority: string;
  status: string;
  kanbanStatus: KanbanStatus;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  currentUnit: string | null;
  currentUnitName: string | null;
  referralPath: ReferralPathNode[];
  lastReferralAt: string | null;
  canAct: boolean;
}

export interface BoardColumn {
  unitKey: string;
  unitName: string;
  unitDescription: string | null;
  cards: BoardCard[];
}

export interface ActorInfo {
  id?: string;
  role: "staff" | "admin";
  unit?: string | null;
  name?: string;
}

export interface Board {
  units: Array<{ key: string; name: string; description: string | null }>;
  columns: BoardColumn[];
  inbox: BoardCard[];
}

export function buildBoard(actor: ActorInfo): Board {
  const units = Referrals.listOrgUnits();
  const staffById = new Map(People.listStaff().map((s) => [s.id, s]));
  const unitName = (key: string | null): string | null =>
    key ? Referrals.getOrgUnit(key)?.name ?? key : null;

  const openCases = Cases.listCases({ status: "open", limit: 2000 });
  const cards: BoardCard[] = openCases.map((c) => {
    const latestRef = Referrals.latestReferralForCase(c.id);
    const refs = Referrals.listReferralsForCase(c.id);
    const assigned = c.assigned_staff_id ? staffById.get(c.assigned_staff_id) ?? null : null;
    const current = currentUnitOfCase(c, latestRef);
    const path: ReferralPathNode[] = refs.map((r) => ({
      depth: r.depth,
      fromName: r.from_staff_id ? staffById.get(r.from_staff_id)?.full_name ?? null : null,
      fromUnit: r.from_unit,
      fromUnitName: unitName(r.from_unit),
      toName: r.to_staff_id ? staffById.get(r.to_staff_id)?.full_name ?? null : null,
      toUnit: r.to_unit,
      toUnitName: unitName(r.to_unit),
      kind: r.kind,
      reason: r.reason,
      at: r.at,
    }));
    const canAct = canActOnCase(c, latestRef, { type: actor.role, id: actor.id, name: actor.name });
    const service = Catalog.getServiceByKey(c.service_key);
    return {
      caseId: c.id,
      code: c.code,
      title: c.title,
      serviceKey: c.service_key,
      serviceName: service?.name ?? c.service_key,
      priority: c.priority,
      status: c.status,
      kanbanStatus: (c.kanban_status as KanbanStatus) ?? "new",
      assignedStaffId: c.assigned_staff_id,
      assignedStaffName: assigned?.full_name ?? null,
      currentUnit: current?.unitKey ?? null,
      currentUnitName: current?.unitName ?? null,
      referralPath: path,
      lastReferralAt: latestRef?.at ?? null,
      canAct,
    };
  });

  const columns: BoardColumn[] = units.map((u) => ({
    unitKey: u.key,
    unitName: u.name,
    unitDescription: u.description,
    cards: cards.filter((card) => card.currentUnit === u.key),
  }));
  const inbox = cards.filter((card) => card.currentUnit === null);

  return {
    units: units.map((u) => ({ key: u.key, name: u.name, description: u.description })),
    columns,
    inbox,
  };
}
