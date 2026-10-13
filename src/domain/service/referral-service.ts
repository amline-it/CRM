/**
 * لایه سرویس کانبان عملیات و ارجاع درون‌سازمانی.
 *
 * پیاده‌سازی منطق فلوچارت:
 *   ویزارد خدمت → باکس اقدام سریع → نوع ارجاع (همکار/واحد، با یا بدون مسئول مشخص)
 *   → تشخیص واحد سازمانی → اعتبارسنجی مجوز (سمت سرور) → ثبت ارجاع + تاریخچه کامل
 *   → به‌روزرسانی مسئول/اولویت/مهلت و وضعیت → انتقال کارت به ستون واحد مقصد
 *   → نمایش مسیر → اقدام مسئول جدید (رسیدگی/اطلاعات/اصلاح/ارجاع مجدد/اتمام/لغو)
 *   → ثبت رویداد، نتیجه و اعلان داخلی.
 *
 * قواعد کلیدی:
 *  - واحد ستون کارت است و وضعیت (`kanban_status`) فیلدی مستقل؛ تغییر واحد = ارجاع تازه.
 *  - «انجام‌شده» یا «لغوشده» شدن عملیات داخلی، وضعیت خدمت (`cases.state/status`) را
 *    دست نمی‌زند؛ تغییر وضعیت خدمت فقط از گذار معتبر همان خدمت انجام می‌شود.
 *  - هر ارجاع یک ردیف تازه در تاریخچه است؛ سابقه بازنویسی نمی‌شود.
 *  - درخواست تکراری (Idempotency-Key) ارجاع/اعلان تکراری نمی‌سازد.
 */
import { AppError } from "@/lib/errors";
import { KANBAN_ACTION_LABELS, KANBAN_STATUS_LABELS } from "@/lib/fa-labels";
import { nowIso, transaction } from "@/db/client";
import { parseJalaliInput } from "@/lib/jalali";
import * as Cases from "@/db/repos/cases";
import * as People from "@/db/repos/people";
import * as Catalog from "@/db/repos/catalog";
import * as Platform from "@/db/repos/platform";
import * as Referrals from "@/db/repos/referrals";
import * as Conv from "@/db/repos/conversations";
import * as Svc from "@/domain/service/case-service";
import { notifyStaff, notifyUnit, referralBody, caseLink } from "./ops-notify";
import type { ActorContext } from "@/domain/engine/types";

export type KanbanStatus = Referrals.KanbanStatus;
export type KanbanAction = "start_review" | "need_info" | "return_correction" | "rerefer" | "complete" | "cancel";

const ACTION_TO_STATUS: Record<Exclude<KanbanAction, "rerefer">, KanbanStatus> = {
  start_review: "in_review",
  need_info: "waiting_info",
  return_correction: "returned_correction",
  complete: "done",
  cancel: "cancelled",
};

/**
 * گذارهای مجاز وضعیت — سمت سرور اعتبارسنجی می‌شود.
 * وضعیت‌های `done`/`cancelled` پایانی‌اند: تکمیل/برگشت/لغو دوباره مجاز نیست،
 * اما «شروع رسیدگی» (بازگشایی) و «ارجاع مجدد» مسیر ادامه کار را باز می‌کنند.
 */
const ALLOWED_ACTIONS: Record<KanbanStatus, KanbanAction[]> = {
  new: ["start_review", "need_info", "return_correction", "complete", "cancel", "rerefer"],
  in_review: ["start_review", "need_info", "return_correction", "complete", "cancel", "rerefer"],
  waiting_info: ["start_review", "need_info", "return_correction", "complete", "cancel", "rerefer"],
  returned_correction: ["start_review", "need_info", "return_correction", "complete", "cancel", "rerefer"],
  done: ["start_review", "rerefer"],
  cancelled: ["start_review", "rerefer"],
};

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

/** کمینه فیلدهای پرونده که برای سنجش دسترسی عملیات لازم است */
export type CaseAccessShape = Pick<Cases.CaseRow, "status" | "assigned_staff_id" | "kanban_status">;

export function statusOf(caseRow: CaseAccessShape): KanbanStatus {
  const value = (caseRow.kanban_status ?? "new") as KanbanStatus;
  return (Referrals.KANBAN_STATUSES as readonly string[]).includes(value) ? value : "new";
}

export function allowedActions(status: KanbanStatus): KanbanAction[] {
  return ALLOWED_ACTIONS[status] ?? [];
}

/* ── کمکی: واحد جاری و دسترسی ──────────────────────────────────────── */

function staffUnit(staffId: string | null): string | null {
  if (!staffId) return null;
  return People.findStaffById(staffId)?.org_unit ?? null;
}

export function currentUnitOfCase(
  caseRow: CaseAccessShape,
  latestRef: Referrals.ReferralRow | null,
): { unitKey: string; unitName: string } | null {
  const key = latestRef ? latestRef.to_unit : staffUnit(caseRow.assigned_staff_id);
  if (!key) return null;
  const unit = Referrals.getOrgUnit(key);
  return { unitKey: key, unitName: unit?.name ?? key };
}

/** مسئول عملیات می‌تواند اقدام کند: مدیر، مسئول فعلی، یا کارمند همان واحد جاری */
export function canActOnCase(caseRow: CaseAccessShape, latestRef: Referrals.ReferralRow | null, actor: ActorContext): boolean {
  if (actor.type === "admin") return true;
  if (actor.id && actor.id === caseRow.assigned_staff_id) return true;
  const unit = currentUnitOfCase(caseRow, latestRef)?.unitKey ?? null;
  if (actor.id && unit) {
    const me = People.findStaffById(actor.id);
    if (me?.org_unit && me.org_unit === unit) return true;
  }
  return false;
}

/* ── اعتبارسنجی ورودی ─────────────────────────────────────────────── */

function normalizePriority(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!(PRIORITIES as readonly string[]).includes(value)) {
    throw new AppError("VALIDATION", "اولویت نامعتبر است");
  }
  return value;
}

/** ورودی مهلت: ISO، «YYYY-MM-DDTHH:mm» یا تاریخ جلالی «۱۴۰۵/۰۷/۲۱» */
export function parseDueAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const jalali = parseJalaliInput(raw);
  if (jalali) return jalali;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new AppError("VALIDATION", "قالب مهلت نامعتبر است");
  return parsed.toISOString();
}

/* ── ارجاع (باکس اقدام سریع) ───────────────────────────────────────── */

export interface ReferInput {
  caseId: string;
  actor: ActorContext;
  kind: "colleague" | "unit";
  toStaffId?: string | null;
  toUnit?: string | null;
  reason?: string | null;
  description?: string | null;
  expectedOutput?: string | null;
  priority?: string | null;
  dueAt?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
}

export interface ReferResult {
  caseId: string;
  referralId: string;
  toUnit: string;
  toUnitName: string;
  toStaffId: string | null;
  toStaffName: string | null;
  kanbanStatus: KanbanStatus;
  statusBefore: KanbanStatus;
  depth: number;
  replayed: boolean;
}

export function referCase(input: ReferInput): ReferResult {
  const caseRow = Cases.findCaseById(input.caseId);
  if (!caseRow) throw new AppError("NOT_FOUND", `پرونده ${input.caseId} یافت نشد`);
  if (caseRow.status === "closed") throw new AppError("CONFLICT", "پرونده بسته شده و قابل ارجاع نیست");

  // بازپخش پاسخ قبلی در صورت retry با همان کلید idempotency.
  // این بررسی عمداً پیش از کنترل دسترسی است: پس از ارجاع موفق، فرستنده دیگر
  // مسئول عملیات نیست و retry شبکه‌ای نباید خطای دسترسی بدهد.
  if (input.idempotencyKey) {
    const existing = Referrals.findReferralByIdempotencyKey(input.caseId, input.idempotencyKey);
    if (existing) {
      if (existing.actor_id && input.actor.id && existing.actor_id !== input.actor.id) {
        throw new AppError("CONFLICT", "این کلید درخواست پیش‌تر توسط کارمند دیگری استفاده شده است");
      }
      return toReferResult(existing, caseRow, true);
    }
  }

  const latestRef = Referrals.latestReferralForCase(input.caseId);
  if (!canActOnCase(caseRow, latestRef, input.actor)) {
    throw new AppError("FORBIDDEN", "شما مسئول این عملیات نیستید و دسترسی ارجاع ندارید");
  }

  const priority = normalizePriority(input.priority);
  const dueAt = parseDueAt(input.dueAt);
  const reason = input.reason?.trim() || null;
  const description = input.description?.trim() || null;
  const expectedOutput = input.expectedOutput?.trim() || null;

  let toStaffId: string | null = null;
  let toUnit: string;
  if (input.kind === "colleague") {
    if (!input.toStaffId) throw new AppError("VALIDATION", "همکار مقصد انتخاب نشده است");
    const target = People.findStaffById(input.toStaffId);
    if (!target || !target.active) throw new AppError("NOT_FOUND", "همکار مقصد یافت نشد یا غیرفعال است");
    if (!target.org_unit) {
      throw new AppError(
        "VALIDATION",
        `کارمند «${target.full_name}» واحد سازمانی ندارد؛ ابتدا واحد او را در بخش کارمندان تنظیم کنید`,
      );
    }
    if (input.toUnit && Referrals.getOrgUnit(input.toUnit) && input.toUnit !== target.org_unit) {
      throw new AppError("VALIDATION", "واحد انتخابی با واحد سازمانی همکار مقصد هم‌خوانی ندارد");
    }
    toUnit = target.org_unit;
    toStaffId = target.id;
  } else {
    if (!input.toUnit) throw new AppError("VALIDATION", "واحد مقصد انتخاب نشده است");
    const unit = Referrals.getOrgUnit(input.toUnit);
    if (!unit) throw new AppError("NOT_FOUND", "واحد مقصد یافت نشد");
    toUnit = unit.key;
    // مسئول مشخص اختیاری است؛ اگر انتخاب شود باید عضو همان واحد باشد
    if (input.toStaffId) {
      const target = People.findStaffById(input.toStaffId);
      if (!target || !target.active) throw new AppError("NOT_FOUND", "مسئول انتخاب‌شده یافت نشد یا غیرفعال است");
      if (target.org_unit !== unit.key) {
        throw new AppError("VALIDATION", `«${target.full_name}» عضو واحد ${unit.name} نیست`);
      }
      toStaffId = target.id;
    }
  }

  const statusBefore = statusOf(caseRow);
  const currentUnit = currentUnitOfCase(caseRow, latestRef)?.unitKey ?? null;
  const fromStaffId = caseRow.assigned_staff_id;
  const isNoOp = Boolean(currentUnit === toUnit && fromStaffId === toStaffId);
  if (isNoOp && !reason && !expectedOutput && !description) {
    throw new AppError("VALIDATION", "مقصد ارجاع با وضعیت فعلی عملیات یکسان است؛ علت یا شرح کار را وارد کنید");
  }

  const service = Catalog.getServiceByKey(caseRow.service_key);
  const now = nowIso();

  const referral = transaction(() => {
    const row = Referrals.recordReferral({
      caseId: input.caseId,
      entityType: "case",
      fromStaffId,
      fromUnit: currentUnit,
      toStaffId,
      toUnit,
      kind: input.kind,
      reason,
      description,
      expectedOutput,
      note: input.note ?? null,
      priority,
      dueAt,
      statusBefore,
      statusAfter: "new",
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      actorName: input.actor.name ?? null,
      serviceKey: caseRow.service_key,
      serviceName: service?.name ?? caseRow.service_key,
      idempotencyKey: input.idempotencyKey ?? null,
    });

    // مسئول، اولویت و مهلت عملیات بر اساس ارجاع تازه
    Referrals.assignCaseToStaff(input.caseId, toStaffId);
    Referrals.setKanbanStatus(input.caseId, "new");
    const patch: Record<string, unknown> = {};
    if (priority) patch.priority = priority;
    if (dueAt) patch.due_at = dueAt;
    if (Object.keys(patch).length) Cases.updateCase(input.caseId, patch);

    const toLabel =
      input.kind === "colleague"
        ? `همکار (${People.findStaffById(toStaffId!)?.full_name ?? ""})`
        : toStaffId
          ? `واحد ${Referrals.getOrgUnit(toUnit)?.name ?? toUnit} — مسئول: ${People.findStaffById(toStaffId)?.full_name ?? ""}`
          : `واحد ${Referrals.getOrgUnit(toUnit)?.name ?? toUnit} (صف واحد)`;

    Cases.insertTimelineEvent({
      caseId: input.caseId,
      kind: "referral.sent",
      title: `ارجاع به ${toLabel}`,
      body: reason ?? description ?? null,
      actorId: input.actor.id ?? null,
      actorName: input.actor.name ?? null,
      at: now,
      meta: {
        referralId: row.id,
        kind: input.kind,
        toUnit,
        toStaffId,
        depth: row.depth,
        statusBefore,
        statusAfter: "new",
        priority,
        dueAt,
        expectedOutput,
      },
    });

    Platform.writeAudit({
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      actorName: input.actor.name ?? null,
      action: "referral.send",
      entityType: "case",
      entityId: input.caseId,
      detail: { referralId: row.id, kind: input.kind, toUnit, toStaffId, statusBefore },
    });

    return row;
  });

  const result = toReferResult(referral, caseRow, false);
  notifyReferral(input.caseId, referral, caseRow, isNoOp);
  return result;
}

function toReferResult(row: Referrals.ReferralRow, caseRow: Cases.CaseRow, replayed: boolean): ReferResult {
  const unit = Referrals.getOrgUnit(row.to_unit);
  const staff = row.to_staff_id ? People.findStaffById(row.to_staff_id) : null;
  return {
    caseId: row.case_id,
    referralId: row.id,
    toUnit: row.to_unit,
    toUnitName: unit?.name ?? row.to_unit,
    toStaffId: row.to_staff_id,
    toStaffName: staff?.full_name ?? null,
    kanbanStatus: statusOf(Cases.findCaseById(row.case_id) ?? caseRow),
    statusBefore: (row.status_before as KanbanStatus) ?? "new",
    depth: row.depth,
    replayed,
  };
}

/** اعلان‌های پس از تراکنش ارجاع */
function notifyReferral(caseId: string, referral: Referrals.ReferralRow, caseRow: Cases.CaseRow, isNoOp: boolean): void {
  const label = caseRow.code ?? caseRow.title ?? caseId;
  const target = referral.to_staff_id
    ? People.findStaffById(referral.to_staff_id)?.full_name ?? "همکار"
    : Referrals.getOrgUnit(referral.to_unit)?.name ?? referral.to_unit;

  if (referral.to_staff_id) {
    notifyStaff({
      staffId: referral.to_staff_id,
      kind: "referral.new",
      caseId,
      body: referralBody(`شما (${target})`, label, referral.reason),
      link: caseLink(caseId, "ops-quick-actions"),
      dedupeKey: `ops:referral:${referral.id}:new:${referral.to_staff_id}`,
      caseRow,
    });
  } else {
    notifyUnit(referral.to_unit, {
      kind: "referral.queue",
      caseId,
      body: `عملیات پرونده ${label} در صف ${target} قرار گرفت${referral.reason ? ` — علت: ${referral.reason}` : ""}`,
      link: caseLink(caseId, "ops-quick-actions"),
      dedupeKey: `ops:referral:${referral.id}:queue`,
      caseRow,
    });
  }

  // مسئول قبلی از تغییر مسئول باخبر می‌شود
  if (referral.from_staff_id && referral.from_staff_id !== referral.actor_id && referral.from_staff_id !== referral.to_staff_id) {
    notifyStaff({
      staffId: referral.from_staff_id,
      kind: "referral.owner_changed",
      caseId,
      body: `مسئولیت عملیات پرونده ${label} به ${target} منتقل شد${isNoOp ? " (بدون تغییر مقصد)" : ""}`,
      link: caseLink(caseId, "ops-quick-actions"),
      dedupeKey: `ops:referral:${referral.id}:leave:${referral.from_staff_id}`,
      caseRow,
    });
  }
}

/** کلید بازپخش پاسخ‌های اقدام، به تفکیک پرونده/کارمند/کلید درخواست */
function idempotencyScope(caseId: string, actorId: string | undefined | null, key: string): string {
  return `ops-act:${caseId}:${actorId ?? "anon"}:${key}`;
}

/* ── اقدام مسئول جدید ─────────────────────────────────────────────── */

export interface ActInput {
  caseId: string;
  actor: ActorContext;
  action: KanbanAction;
  reason?: string | null;
  resultNote?: string | null;
  kind?: "colleague" | "unit";
  toStaffId?: string | null;
  toUnit?: string | null;
  description?: string | null;
  expectedOutput?: string | null;
  priority?: string | null;
  dueAt?: string | null;
  idempotencyKey?: string | null;
}

export interface ActResult {
  caseId: string;
  kanbanStatus: KanbanStatus;
  statusBefore: KanbanStatus;
  action: KanbanAction;
  referralId?: string;
  replayed?: boolean;
}

export function actOnCard(input: ActInput): ActResult {
  const caseRow = Cases.findCaseById(input.caseId);
  if (!caseRow) throw new AppError("NOT_FOUND", `پرونده ${input.caseId} یافت نشد`);
  if (caseRow.status === "closed") throw new AppError("CONFLICT", "پرونده بسته شده است");

  const latestRef = Referrals.latestReferralForCase(input.caseId);
  if (!canActOnCase(caseRow, latestRef, input.actor)) {
    // کارمند واحد جاری که مسئول مشخص نیست هم می‌تواند در صورت داشتن کلید بازپخش، پاسخ قبلی را بگیرد
    if (input.idempotencyKey && !latestRef?.to_staff_id) {
      const previous = Platform.getIdempotentResponse(idempotencyScope(input.caseId, input.actor.id, input.idempotencyKey));
      if (previous?.response) return { ...(JSON.parse(previous.response) as ActResult), replayed: true };
    }
    throw new AppError("FORBIDDEN", "شما مسئول این عملیات نیستید و دسترسی اقدام ندارید");
  }

  // بازپخش پاسخ قبلی برای retry (پیش از کنترل دسترسی — همان دلیل referCase)
  if (input.action !== "rerefer" && input.idempotencyKey) {
    const previous = Platform.getIdempotentResponse(idempotencyScope(input.caseId, input.actor.id, input.idempotencyKey));
    if (previous?.response) {
      return { ...(JSON.parse(previous.response) as ActResult), replayed: true };
    }
  }

  if (input.action === "rerefer") {
    const referral = referCase({
      caseId: input.caseId,
      actor: input.actor,
      kind: input.kind ?? "unit",
      toStaffId: input.toStaffId,
      toUnit: input.toUnit,
      reason: input.reason,
      description: input.description,
      expectedOutput: input.expectedOutput,
      priority: input.priority,
      dueAt: input.dueAt,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      caseId: input.caseId,
      kanbanStatus: referral.kanbanStatus,
      statusBefore: referral.statusBefore,
      action: "rerefer",
      referralId: referral.referralId,
      replayed: referral.replayed,
    };
  }

  const statusBefore = statusOf(caseRow);
  if (!allowedActions(statusBefore).includes(input.action)) {
    throw new AppError(
      "INVALID_TRANSITION",
      `از وضعیت «${KANBAN_STATUS_LABELS[statusBefore] ?? statusBefore}» انجام «${KANBAN_ACTION_LABELS[input.action] ?? input.action}» مجاز نیست`,
    );
  }

  const status = ACTION_TO_STATUS[input.action];
  const reason = input.reason?.trim() || null;
  const resultNote = input.resultNote?.trim() || reason;
  if ((input.action === "return_correction" || input.action === "cancel") && !reason) {
    throw new AppError(
      "VALIDATION",
      input.action === "cancel" ? "برای لغو عملیات، علت الزامی است" : "برای برگشت کار، علت اصلاح الزامی است",
    );
  }

  const priority = normalizePriority(input.priority);
  const dueAt = parseDueAt(input.dueAt);

  const result = transaction(() => {
    Referrals.setKanbanStatus(input.caseId, status);
    const patch: Record<string, unknown> = {};
    if (priority) patch.priority = priority;
    if (dueAt) patch.due_at = dueAt;
    if (Object.keys(patch).length) Cases.updateCase(input.caseId, patch);

    // نتیجه/علت برگشت روی آخرین ارجاع ثبت می‌شود (سابقه پاک نمی‌شود)
    if (latestRef) {
      Referrals.completeReferral(latestRef.id, {
        result: input.action === "complete" ? "completed" : input.action === "cancel" ? "cancelled" : input.action,
        outcomeNote: resultNote,
        statusAfter: status,
      });
    }

    const label = KANBAN_ACTION_LABELS[input.action] ?? input.action;
    Cases.insertTimelineEvent({
      caseId: input.caseId,
      kind: "referral.action",
      title: `اقدام مسئول: ${label}`,
      body: resultNote,
      actorId: input.actor.id ?? null,
      actorName: input.actor.name ?? null,
      at: nowIso(),
      meta: { action: input.action, statusBefore, statusAfter: status, referralId: latestRef?.id ?? null },
    });

    Platform.writeAudit({
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      actorName: input.actor.name ?? null,
      action: `referral.act.${input.action}`,
      entityType: "case",
      entityId: input.caseId,
      detail: { action: input.action, statusBefore, status, reason: resultNote },
    });

    const payload: ActResult = {
      caseId: input.caseId,
      kanbanStatus: status,
      statusBefore,
      action: input.action,
      referralId: latestRef?.id,
    };
    if (input.idempotencyKey) {
      Platform.saveIdempotentResponse(idempotencyScope(input.caseId, input.actor.id, input.idempotencyKey), "ops-act", 200, payload);
    }
    return payload;
  });

  notifyAction(input.caseId, caseRow, latestRef, input, statusBefore, status);
  return result;
}

/** اعلان‌های اقدام وضعیت (برگشت، اتمام، لغو، شروع رسیدگی) */
function notifyAction(
  caseId: string,
  caseRow: Cases.CaseRow,
  latestRef: Referrals.ReferralRow | null,
  input: ActInput,
  statusBefore: KanbanStatus,
  status: KanbanStatus,
): void {
  const label = caseRow.code ?? caseRow.title ?? caseId;
  const referrer = latestRef?.actor_id ?? latestRef?.from_staff_id ?? null;
  const actorName = input.actor.name ?? "کارمند";
  const bodyByAction: Partial<Record<KanbanAction, string>> = {
    start_review: `${actorName} رسیدگی به عملیات پرونده ${label} را آغاز کرد`,
    need_info: `عملیات پرونده ${label} منتظر اطلاعات است`,
    return_correction: `عملیات پرونده ${label} برای اصلاح برگشت داده شد${input.reason ? ` — علت: ${input.reason}` : ""}`,
    complete: `عملیات پرونده ${label} توسط ${actorName} انجام شد`,
    cancel: `عملیات پرونده ${label} لغو شد${input.reason ? ` — علت: ${input.reason}` : ""}`,
  };
  const kindByAction: Partial<Record<KanbanAction, "referral.returned" | "referral.done" | "referral.cancelled" | "referral.rereferred">> = {
    return_correction: "referral.returned",
    complete: "referral.done",
    cancel: "referral.cancelled",
  };
  const body = bodyByAction[input.action];
  if (!body) return;
  const kind = kindByAction[input.action] ?? "referral.rereferred";

  if (referrer && referrer !== input.actor.id) {
    notifyStaff({
      staffId: referrer,
      kind,
      caseId,
      body,
      link: caseLink(caseId, "ops-quick-actions"),
      dedupeKey: `ops:act:${caseId}:${input.action}:${status}:${referrer}`,
      caseRow,
    });
  }

  // مالک پرونده (کاربر) هرگز اعلان داخلی نمی‌گیرد؛ اعلان داخلی فقط برای کارمندان است.
  void statusBefore;
}

/* ── ایجاد کارت اولیه (ورودی ویزارد خدمت) ─────────────────────────── */

export interface CreateKanbanCardInput {
  actor: ActorContext;
  serviceKey: string;
  title: string;
  priority?: string;
  dueAt?: string | null;
  description?: string | null;
}

export function createKanbanCard(input: CreateKanbanCardInput): { caseId: string } {
  const service = Catalog.getServiceByKey(input.serviceKey);
  if (!service) throw new AppError("NOT_FOUND", `خدمت «${input.serviceKey}» یافت نشد`);
  const priority = normalizePriority(input.priority) ?? "normal";
  const dueAt = parseDueAt(input.dueAt);
  const created = Svc.createCase({
    serviceKey: input.serviceKey,
    title: input.title,
    priority: priority as Cases.CaseRow["priority"],
    assignedStaffId: input.actor.id ?? null,
  });

  // ثبت ارجاع اولیه (ورود به واحد سازمانی مسئول)
  const unit = staffUnit(input.actor.id ?? null);
  if (unit) {
    Referrals.recordReferral({
      caseId: created.caseId,
      entityType: "case",
      fromStaffId: null,
      fromUnit: null,
      toStaffId: input.actor.id ?? null,
      toUnit: unit,
      kind: "unit",
      reason: "ثبت اولیه در واحد",
      description: input.description ?? null,
      priority,
      dueAt,
      statusBefore: null,
      statusAfter: "new",
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      actorName: input.actor.name ?? null,
      serviceKey: input.serviceKey,
      serviceName: service.name,
    });
  }
  if (dueAt) Cases.updateCase(created.caseId, { due_at: dueAt });

  Platform.writeAudit({
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    actorName: input.actor.name ?? null,
    action: "referral.card_create",
    entityType: "case",
    entityId: created.caseId,
    detail: { serviceKey: input.serviceKey },
  });

  return { caseId: created.caseId };
}

/* ── ساخت داده تخته کانبان ─────────────────────────────────────────── */

export interface ReferralPathNode {
  id: string;
  depth: number;
  kind: "colleague" | "unit";
  actorName: string | null;
  fromName: string | null;
  fromUnit: string | null;
  fromUnitName: string | null;
  toName: string | null;
  toUnit: string;
  toUnitName: string | null;
  reason: string | null;
  description: string | null;
  expectedOutput: string | null;
  note: string | null;
  priority: string | null;
  dueAt: string | null;
  statusBefore: string | null;
  statusAfter: string | null;
  result: string | null;
  outcomeNote: string | null;
  at: string;
}

export interface BoardCard {
  caseId: string;
  code: string | null;
  title: string | null;
  serviceKey: string;
  serviceName: string;
  serviceKind: string;
  priority: string;
  caseStatus: string;
  workflowState: string;
  dueAt: string | null;
  overdue: boolean;
  kanbanStatus: KanbanStatus;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  currentUnit: string | null;
  currentUnitName: string | null;
  hasOwner: boolean;
  referralPath: ReferralPathNode[];
  lastReferralAt: string | null;
  lastReferrerName: string | null;
  lastTargetName: string | null;
  unreadMessages: number;
  lastMessage: { body: string; authorName: string | null; at: string } | null;
  canAct: boolean;
  allowedActions: KanbanAction[];
  caseUrl: string;
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

export interface BoardFilterInput {
  serviceKey?: string;
  unitKey?: string;
  staffId?: string;
  kanbanStatus?: string;
  priority?: string;
  due?: "overdue" | "today" | "week" | "none";
  search?: string;
  unassigned?: boolean;
  mine?: boolean;
  includeClosed?: boolean;
}

export interface BoardStats {
  total: number;
  overdue: number;
  unassigned: number;
  unreadMessages: number;
  done: number;
  cancelled: number;
}

export interface Board {
  units: Array<{ key: string; name: string; description: string | null }>;
  columns: BoardColumn[];
  inbox: BoardCard[];
  stats: BoardStats;
  filter: BoardFilterInput;
}

function mapReferralNode(
  row: Referrals.ReferralRow,
  staffById: Map<string, People.StaffRow>,
  unitName: (key: string | null) => string | null,
): ReferralPathNode {
  return {
    id: row.id,
    depth: row.depth,
    kind: row.kind,
    actorName: row.actor_name ?? (row.actor_id ? staffById.get(row.actor_id)?.full_name ?? null : null),
    fromName: row.from_staff_id ? staffById.get(row.from_staff_id)?.full_name ?? null : null,
    fromUnit: row.from_unit,
    fromUnitName: unitName(row.from_unit),
    toName: row.to_staff_id ? staffById.get(row.to_staff_id)?.full_name ?? null : null,
    toUnit: row.to_unit,
    toUnitName: unitName(row.to_unit),
    reason: row.reason,
    description: row.description,
    expectedOutput: row.expected_output,
    note: row.note,
    priority: row.priority,
    dueAt: row.due_at,
    statusBefore: row.status_before,
    statusAfter: row.status_after,
    result: row.result,
    outcomeNote: row.outcome_note,
    at: row.at,
  };
}

export function buildBoard(actor: ActorInfo, filter: BoardFilterInput = {}): Board {
  const units = Referrals.listOrgUnits();
  const staffById = new Map(People.listStaff().map((s) => [s.id, s]));
  const unitName = (key: string | null): string | null => (key ? Referrals.getOrgUnit(key)?.name ?? key : null);

  const rows = Referrals.listBoardCases({
    serviceKey: filter.serviceKey,
    unitKey: filter.unitKey,
    staffId: filter.mine ? actor.id : filter.staffId,
    kanbanStatus: filter.kanbanStatus,
    priority: filter.priority,
    due: filter.due,
    search: filter.search,
    unassigned: filter.unassigned,
    includeClosed: filter.includeClosed,
    limit: 400,
  });

  const caseIds = rows.map((r) => r.case_id);
  const referrals = Referrals.listReferralsForCases(caseIds);
  const referralsByCase = new Map<string, Referrals.ReferralRow[]>();
  for (const referral of referrals) {
    const list = referralsByCase.get(referral.case_id) ?? [];
    list.push(referral);
    referralsByCase.set(referral.case_id, list);
  }

  const actorCtx: ActorContext = { type: actor.role, id: actor.id, name: actor.name };
  const unread = actor.id ? Conv.unreadCountsByCase(actor.id, caseIds) : {};
  const lastMessages = Conv.latestMessagesForCases(caseIds);
  const lastByCase = new Map<string, { body: string; author_name: string | null; created_at: string }>();
  for (const msg of lastMessages) if (!lastByCase.has(msg.case_id)) lastByCase.set(msg.case_id, msg);

  const now = Date.now();
  const cards: BoardCard[] = rows.map((row) => {
    const path = (referralsByCase.get(row.case_id) ?? []).map((r) => mapReferralNode(r, staffById, unitName));
    const latest = path.length ? path[path.length - 1] : null;
    const assigned = row.assigned_staff_id ? staffById.get(row.assigned_staff_id) ?? null : null;
    const accessShape: CaseAccessShape = {
      status: row.status as Cases.CaseRow["status"],
      assigned_staff_id: row.assigned_staff_id,
      kanban_status: row.kanban_status,
    };
    const latestRef = referralsByCase.get(row.case_id)?.slice(-1)[0] ?? null;
    const canAct = canActOnCase(accessShape, latestRef ?? null, actorCtx);
    const service = Catalog.getServiceByKey(row.service_key);
    const status = (Referrals.KANBAN_STATUSES as readonly string[]).includes(row.kanban_status)
      ? (row.kanban_status as KanbanStatus)
      : "new";
    return {
      caseId: row.case_id,
      code: row.code,
      title: row.title,
      serviceKey: row.service_key,
      serviceName: service?.name ?? row.service_key,
      serviceKind: service?.category ?? "custom",
      priority: row.priority,
      caseStatus: row.status,
      workflowState: row.state,
      dueAt: row.due_at,
      overdue: Boolean(row.due_at && new Date(row.due_at).getTime() < now && status !== "done" && status !== "cancelled"),
      kanbanStatus: status,
      assignedStaffId: row.assigned_staff_id,
      assignedStaffName: assigned?.full_name ?? null,
      currentUnit: row.current_unit,
      currentUnitName: unitName(row.current_unit),
      hasOwner: Boolean(row.assigned_staff_id),
      referralPath: path,
      lastReferralAt: row.last_referral_at,
      lastReferrerName: latest?.actorName ?? latest?.fromName ?? null,
      lastTargetName: latest?.toName ?? latest?.toUnitName ?? null,
      unreadMessages: unread[row.case_id] ?? 0,
      lastMessage: (() => {
        const msg = lastByCase.get(row.case_id);
        return msg ? { body: msg.body, authorName: msg.author_name, at: msg.created_at } : null;
      })(),
      canAct,
      allowedActions: canAct ? allowedActions(status) : [],
      caseUrl: `/panel/cases/${row.case_id}`,
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
    stats: {
      total: cards.length,
      overdue: cards.filter((c) => c.overdue).length,
      unassigned: cards.filter((c) => !c.hasOwner).length,
      unreadMessages: cards.reduce((sum, c) => sum + c.unreadMessages, 0),
      done: cards.filter((c) => c.kanbanStatus === "done").length,
      cancelled: cards.filter((c) => c.kanbanStatus === "cancelled").length,
    },
    filter: {
      serviceKey: filter.serviceKey,
      unitKey: filter.unitKey,
      staffId: filter.staffId,
      kanbanStatus: filter.kanbanStatus,
      priority: filter.priority,
      due: filter.due,
      search: filter.search,
      mine: filter.mine,
      unassigned: filter.unassigned,
    },
  };
}

/* ── جزئیات عملیات یک پرونده (برای صفحه پرونده و API) ─────────────── */

export interface CaseOpsView {
  caseId: string;
  kanbanStatus: KanbanStatus;
  statusLabel: string;
  currentUnit: string | null;
  currentUnitName: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  hasOwner: boolean;
  priority: string;
  dueAt: string | null;
  overdue: boolean;
  canAct: boolean;
  allowedActions: KanbanAction[];
  referralPath: ReferralPathNode[];
  unreadMessages: number;
}

export function getCaseOps(caseId: string, actor: ActorContext): CaseOpsView {
  const caseRow = Cases.findCaseById(caseId);
  if (!caseRow) throw new AppError("NOT_FOUND", "پرونده یافت نشد");
  const refs = Referrals.listReferralsForCase(caseId);
  const staffById = new Map(People.listStaff().map((s) => [s.id, s]));
  const unitName = (key: string | null): string | null => (key ? Referrals.getOrgUnit(key)?.name ?? key : null);
  const latestRef = refs.length ? refs[refs.length - 1] : null;
  const current = currentUnitOfCase(caseRow, latestRef);
  const status = statusOf(caseRow);
  const canAct = canActOnCase(caseRow, latestRef, actor);
  const assigned = caseRow.assigned_staff_id ? People.findStaffById(caseRow.assigned_staff_id) : null;
  const unread = actor.id ? Conv.unreadCountsByCase(actor.id, [caseId])[caseId] ?? 0 : 0;

  return {
    caseId,
    kanbanStatus: status,
    statusLabel: KANBAN_STATUS_LABELS[status] ?? status,
    currentUnit: current?.unitKey ?? null,
    currentUnitName: current?.unitName ?? null,
    assignedStaffId: caseRow.assigned_staff_id,
    assignedStaffName: assigned?.full_name ?? null,
    hasOwner: Boolean(caseRow.assigned_staff_id),
    priority: caseRow.priority,
    dueAt: caseRow.due_at,
    overdue: Boolean(caseRow.due_at && new Date(caseRow.due_at).getTime() < Date.now() && status !== "done" && status !== "cancelled"),
    canAct,
    allowedActions: canAct ? allowedActions(status) : [],
    referralPath: refs.map((r) => mapReferralNode(r, staffById, unitName)),
    unreadMessages: unread,
  };
}
