"use server";

import { revalidatePath } from "next/cache";
import { toErrorResponse, AppError } from "@/lib/errors";
import { assertCsrf, requirePermission, type CurrentSession } from "@/auth/session";
import * as Referrals from "@/db/repos/referrals";
import * as Svc from "@/domain/service/referral-service";
import * as Columns from "@/domain/service/board-columns";
import type { ActorContext } from "@/domain/engine/types";

export interface ActionState {
  error?: string;
  message?: string;
}

function text(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (value === null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function actorOf(session: CurrentSession): ActorContext {
  return { type: session.role, id: session.staff.id, name: session.staff.full_name };
}

const KANBAN_REVALIDATE = "/panel/kanban";

/* ── ارجاع از باکس اقدام سریع ──────────────────────────────────────── */

export async function referAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("referral.create");
    const caseId = text(form, "caseId");
    const kind = text(form, "kind") as "colleague" | "unit" | null;
    if (!caseId) return { error: "پرونده مشخص نیست" };
    if (kind !== "colleague" && kind !== "unit") return { error: "نوع ارجاع انتخاب نشده است" };

    Svc.referCase({
      caseId,
      actor: actorOf(session),
      kind,
      toStaffId: kind === "colleague" ? text(form, "toStaffId") : null,
      toUnit: kind === "unit" ? text(form, "toUnit") : null,
      reason: text(form, "reason"),
    });
    revalidatePath(KANBAN_REVALIDATE);
    return { message: "ارجاع ثبت و کارت به ستون مقصد منتقل شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطای ارجاع") };
  }
}

/* ── اقدام مسئول جدید ─────────────────────────────────────────────── */

export async function actAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("referral.create");
    const caseId = text(form, "caseId");
    const action = text(form, "action") as Svc.KanbanAction | null;
    if (!caseId) return { error: "پرونده مشخص نیست" };
    if (!action) return { error: "اقدام انتخاب نشده است" };

    Svc.actOnCard({
      caseId,
      actor: actorOf(session),
      action,
      reason: text(form, "reason"),
      kind: text(form, "kind") as "colleague" | "unit" | null ?? undefined,
      toStaffId: text(form, "toStaffId"),
      toUnit: text(form, "toUnit"),
    });
    revalidatePath(KANBAN_REVALIDATE);
    return { message: "اقدام ثبت و کانبان به‌روزرسانی شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطای اقدام") };
  }
}

/* ── ایجاد کارت جدید (ورودی ویزارد خدمت) ──────────────────────────── */

export async function createKanbanCardAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("referral.create");
    const serviceKey = text(form, "serviceKey");
    const title = text(form, "title");
    if (!serviceKey) return { error: "خدمت انتخاب نشده است" };
    if (!title) return { error: "عنوان خدمت الزامی است" };

    const { caseId } = Svc.createKanbanCard({
      actor: actorOf(session),
      serviceKey,
      title,
      priority: text(form, "priority") ?? undefined,
      dueAt: text(form, "dueAt"),
      description: text(form, "description"),
    });
    revalidatePath(KANBAN_REVALIDATE);
    return { message: `کارت «${title}» ایجاد و در واحد شما ثبت شد (${caseId})` };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطای ایجاد کارت") };
  }
}

/* ── بازچینش ترتیب ستون‌ها (واحدها) — درگ‌انددراپ ستون‌ها ──────────────
 * مسیر اصلی UI از API ops (`PUT /api/v1/ops/board/columns`) استفاده می‌کند؛ این
 * اکشن سرور هم همان سرویس مشترک چیدمان را صدا می‌زند تا دو پیاده‌سازی واگرا نشوند.
 */

export async function reorderOrgUnitsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("referral.manage");
    const order = text(form, "order");
    if (!order) return { error: "ترتیب ستون‌ها مشخص نیست" };
    const keys = order.split(",").map((k) => k.trim()).filter(Boolean);
    if (!keys.length) return { error: "ترتیب ستون‌ها خالی است" };
    Columns.applyTeamColumnOrder(keys, session.staff.id);
    revalidatePath(KANBAN_REVALIDATE);
    return { message: "ترتیب ستون‌های کانبان ذخیره شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطای بازچینش ستون‌ها") };
  }
}

/* ── مدیریت واحدهای سازمانی (مدیر) ─────────────────────────────────── */

export async function manageOrgUnitAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    await requirePermission("referral.manage");
    const op = text(form, "op");
    if (op === "delete") {
      const id = text(form, "unitId");
      if (!id) return { error: "واحد مشخص نیست" };
      if (Referrals.countReferralsForUnit(id)) {
        return { error: "این واحد تاریخچه ارجاع دارد و قابل حذف نیست" };
      }
      Referrals.deleteOrgUnit(id);
      revalidatePath(KANBAN_REVALIDATE);
      return { message: "واحد حذف شد" };
    }

    const key = text(form, "key");
    const name = text(form, "name");
    const description = text(form, "description");
    const sortOrderRaw = text(form, "sortOrder");
    if (!key || !name) return { error: "کلید و نام واحد الزامی است" };
    if (!/^[a-z0-9_-]{2,}$/.test(key)) return { error: "کلید واحد باید انگلیسی و حداقل ۲ کاراکتر باشد" };
    const sortOrder = sortOrderRaw ? Number(sortOrderRaw) : 0;

    if (op === "update") {
      const id = text(form, "unitId");
      if (!id) return { error: "واحد مشخص نیست" };
      const existing = Referrals.getOrgUnit(key);
      if (existing && existing.id !== id) return { error: "کلید واحد تکراری است" };
      Referrals.updateOrgUnit(id, { key, name, description, sortOrder });
      revalidatePath(KANBAN_REVALIDATE);
      return { message: "واحد به‌روزرسانی شد" };
    }

    if (Referrals.getOrgUnit(key)) return { error: "واحدی با این کلید از قبل وجود دارد" };
    Referrals.createOrgUnit({ key, name, description, sortOrder });
    revalidatePath(KANBAN_REVALIDATE);
    return { message: "واحد سازمانی جدید ایجاد شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطای مدیریت واحد") };
  }
}
