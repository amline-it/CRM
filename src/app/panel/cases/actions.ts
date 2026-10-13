"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError, toErrorResponse } from "@/lib/errors";
import { assertCsrf, requirePermission } from "@/auth/session";
import { can } from "@/auth/rbac";
import * as Cases from "@/db/repos/cases";
import * as Catalog from "@/db/repos/catalog";
import * as Platform from "@/db/repos/platform";
import * as Svc from "@/domain/service/case-service";
import type { Priority } from "@/domain/engine/types";

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

function number(form: FormData, key: string): number | null {
  const raw = text(form, key);
  if (raw === null) return null;
  const n = Number(raw.replace(/[,٬\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function createCaseAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("case.create");
    const serviceKey = text(form, "serviceKey");
    if (!serviceKey) return { error: "خدمت را انتخاب کنید" };
    const ownerUserId = text(form, "ownerUserId");
    const agentUserId = text(form, "agentUserId");
    const reason = text(form, "note");
    const created = Svc.createCase({
      serviceKey,
      ownerUserId,
      agentUserId,
      title: text(form, "title"),
      priority: (text(form, "priority") as Priority | null) ?? "normal",
      assignedStaffId: session.staff.id,
    });
    if (reason) {
      Cases.insertTimelineEvent({
        caseId: created.caseId,
        kind: "case.note",
        title: "یادداشت کارشناس",
        body: reason,
        actorId: session.staff.id,
        actorName: session.staff.full_name,
        at: new Date().toISOString(),
      });
    }
    Platform.writeAudit({
      actorType: session.role,
      actorId: session.staff.id,
      actorName: session.staff.full_name,
      action: "case.create",
      entityType: "case",
      entityId: created.caseId,
      detail: { serviceKey },
    });
    redirect(`/panel/cases/${created.caseId}`);
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطای نامشخص") };
  }
}

export async function transitionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const caseId = String(form.get("caseId") ?? "");
  try {
    await assertCsrf(form);
    const session = await requirePermission("case.transition");
    const transitionKey = String(form.get("transitionKey") ?? "");
    if (!caseId || !transitionKey) return { error: "درخواست نامعتبر است" };

    const payload: Record<string, unknown> = {};
    const reason = text(form, "reason");
    const option = text(form, "option");
    for (const key of ["decision", "code", "revisionNote", "paymentResult", "note", "needsFollowup"]) {
      const value = text(form, key);
      if (value !== null) payload[key] = value;
    }
    if (payload.needsFollowup !== undefined) payload.needsFollowup = payload.needsFollowup === "true";

    // کنش‌های ویژه: پرداخت و ثبت کد رهگیری از مسیر سرویس می‌گذرند
    if (transitionKey === "payment_record") {
      const method = (text(form, "method") ?? "direct") as "direct" | "subscription" | "referral" | "free";
      const simulateFailure = text(form, "simulateFailure") === "true";
      const result = Svc.recordPaymentAttempt({ caseId, method, simulateFailure, actor: { type: session.role, id: session.staff.id, name: session.staff.full_name } });
      revalidatePath(`/panel/cases/${caseId}`);
      return { message: result.status === "succeeded" ? "پرداخت موفق ثبت شد" : "پرداخت ناموفق ثبت شد و برای پیگیری وظیفه ساخته شد" };
    }

    const applied = Svc.applyTransition({
      caseId,
      transitionKey,
      option,
      reason,
      payload,
      actor: { type: session.role, id: session.staff.id, name: session.staff.full_name },
    });
    Platform.writeAudit({
      actorType: session.role,
      actorId: session.staff.id,
      actorName: session.staff.full_name,
      action: `case.transition.${transitionKey}`,
      entityType: "case",
      entityId: caseId,
      detail: { from: applied.from, to: applied.to, option },
    });
    revalidatePath(`/panel/cases/${caseId}`);
    revalidatePath("/panel/cases");
    return { message: `گذار «${applied.plan.transitionName}» انجام شد` };
  } catch (err) {
    const { body } = toErrorResponse(err);
    revalidatePath(`/panel/cases/${caseId}`);
    return { error: String(body.message ?? "خطا در اجرای گذار") };
  }
}

export async function saveContractAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const caseId = String(form.get("caseId") ?? "");
  try {
    await assertCsrf(form);
    const session = await requirePermission("case.transition");
    const input = {
      contractType: text(form, "contractType") ?? undefined,
      outputMode: text(form, "outputMode") ?? undefined,
      propertyAddress: text(form, "propertyAddress") ?? undefined,
      city: text(form, "city") ?? undefined,
      district: text(form, "district") ?? undefined,
      area: number(form, "area") ?? undefined,
      rooms: undefined,
      landlordName: text(form, "landlordName") ?? undefined,
      tenantName: text(form, "tenantName") ?? undefined,
      sellerName: text(form, "sellerName") ?? undefined,
      buyerName: text(form, "buyerName") ?? undefined,
      depositAmount: number(form, "depositAmount") ?? undefined,
      rentAmount: number(form, "rentAmount") ?? undefined,
      salePrice: number(form, "salePrice") ?? undefined,
      startDate: text(form, "startDate") ?? undefined,
      endDate: text(form, "endDate") ?? undefined,
      termsNote: text(form, "termsNote") ?? undefined,
    };
    Svc.saveContractDetails(caseId, input, { type: session.role, id: session.staff.id, name: session.staff.full_name });
    revalidatePath(`/panel/cases/${caseId}`);
    return { message: "اطلاعات قرارداد ذخیره شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در ذخیره اطلاعات قرارداد") };
  }
}

export async function reviewDocumentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const caseId = String(form.get("caseId") ?? "");
  try {
    await assertCsrf(form);
    const session = await requirePermission("document.review");
    const documentId = String(form.get("documentId") ?? "");
    const status = String(form.get("status") ?? "") as "approved" | "rejected" | "incomplete";
    if (!documentId || !["approved", "rejected", "incomplete"].includes(status)) return { error: "درخواست نامعتبر است" };
    Svc.reviewDocumentAction({
      documentId,
      status,
      reviewNote: text(form, "reviewNote"),
      actor: { type: session.role, id: session.staff.id, name: session.staff.full_name },
    });
    revalidatePath(`/panel/cases/${caseId}`);
    return { message: "وضعیت مدرک ثبت شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در بررسی مدرک") };
  }
}

export async function markSignatureAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const caseId = String(form.get("caseId") ?? "");
  try {
    await assertCsrf(form);
    const session = await requirePermission("case.transition");
    const party = String(form.get("party") ?? "");
    const status = String(form.get("status") ?? "signed") as "signed" | "declined" | "pending";
    if (!party) return { error: "طرف امضا مشخص نیست" };
    Svc.markSignature({
      caseId,
      party,
      status,
      partyName: text(form, "partyName"),
      note: text(form, "signatureNote"),
      actor: { type: session.role, id: session.staff.id, name: session.staff.full_name },
    });
    revalidatePath(`/panel/cases/${caseId}`);
    return { message: status === "signed" ? "امضا ثبت شد" : "وضعیت امضا ثبت شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در ثبت امضا") };
  }
}

export async function saveListingAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const caseId = String(form.get("caseId") ?? "");
  try {
    await assertCsrf(form);
    const session = await requirePermission("listing.manage");
    const listing = Catalog.findListingByCase(caseId);
    if (!listing) return { error: "پرونده آگهی یافت نشد" };
    const imagesRaw = text(form, "images");
    Catalog.updateListing(listing.id, {
      deal_type: text(form, "dealType") ?? listing.deal_type,
      property_type: text(form, "propertyType") ?? listing.property_type,
      city: text(form, "city") ?? undefined,
      district: text(form, "district") ?? undefined,
      address: text(form, "address") ?? undefined,
      area: number(form, "area") ?? undefined,
      rooms: number(form, "rooms") ?? undefined,
      deposit: number(form, "deposit") ?? undefined,
      rent: number(form, "rent") ?? undefined,
      price: number(form, "price") ?? undefined,
      description: text(form, "description") ?? undefined,
      images: imagesRaw ? imagesRaw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : undefined,
    });
    revalidatePath(`/panel/cases/${caseId}`);
    revalidatePath("/panel/listings");
    return { message: "اطلاعات آگهی ذخیره شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در ذخیره آگهی") };
  }
}

export async function saveRequirementAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const caseId = String(form.get("caseId") ?? "");
  try {
    await assertCsrf(form);
    const session = await requirePermission("requirement.manage");
    const requirement = Catalog.findRequirementByCase(caseId);
    if (!requirement) return { error: "پرونده نیازمندی یافت نشد" };
    const districtsRaw = text(form, "districts");
    Catalog.updateRequirement(requirement.id, {
      deal_type: text(form, "dealType") ?? requirement.deal_type,
      property_type: text(form, "propertyType") ?? undefined,
      city: text(form, "city") ?? undefined,
      districts: districtsRaw ? districtsRaw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : undefined,
      budget_min: number(form, "budgetMin") ?? undefined,
      budget_max: number(form, "budgetMax") ?? undefined,
      area_min: number(form, "areaMin") ?? undefined,
      area_max: number(form, "areaMax") ?? undefined,
      rooms: number(form, "rooms") ?? undefined,
      description: text(form, "description") ?? undefined,
      expires_at: text(form, "expiresAt") ?? undefined,
    });
    revalidatePath(`/panel/cases/${caseId}`);
    revalidatePath("/panel/requirements");
    return { message: "اطلاعات نیازمندی ذخیره شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در ذخیره نیازمندی") };
  }
}

export async function computeMatchesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const caseId = String(form.get("caseId") ?? "");
  try {
    await assertCsrf(form);
    await requirePermission("requirement.manage");
    const count = Svc.computeMatchesForCase(caseId);
    revalidatePath(`/panel/cases/${caseId}`);
    return { message: `${count} آگهی متناسب پیدا شد` };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در تطبیق") };
  }
}

export async function addTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const caseId = String(form.get("caseId") ?? "");
  try {
    await assertCsrf(form);
    const session = await requirePermission("task.manage");
    Cases.createTask({
      caseId: caseId || null,
      title: text(form, "title") ?? "پیگیری",
      description: text(form, "description"),
      priority: (text(form, "priority") as Priority | null) ?? "normal",
      dueAt: text(form, "dueAt"),
      assigneeId: text(form, "assigneeId") ?? session.staff.id,
      createdBy: session.staff.id,
    });
    revalidatePath(`/panel/cases/${caseId}`);
    revalidatePath("/panel/tasks");
    return { message: "وظیفه ثبت شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در ثبت وظیفه") };
  }
}

export async function completeTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    await requirePermission("task.manage");
    const taskId = String(form.get("taskId") ?? "");
    const caseId = String(form.get("caseId") ?? "");
    if (!taskId) return { error: "وظیفه مشخص نیست" };
    Cases.updateTask(taskId, { status: "done", result_note: text(form, "resultNote") });
    revalidatePath(`/panel/cases/${caseId}`);
    revalidatePath("/panel/tasks");
    return { message: "وظیفه انجام‌شده ثبت شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در بستن وظیفه") };
  }
}

export async function reassignCaseAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const caseId = String(form.get("caseId") ?? "");
  try {
    await assertCsrf(form);
    const session = await requirePermission("case.assign");
    const staffId = text(form, "assignedStaffId");
    const priority = text(form, "priority") as Priority | null;
    if (!can(session.role, "case.assign")) throw new AppError("FORBIDDEN", "دسترسی ندارید");
    Cases.updateCase(caseId, {
      assigned_staff_id: staffId,
      priority: priority ?? undefined,
    });
    revalidatePath(`/panel/cases/${caseId}`);
    return { message: "پرونده به‌روزرسانی شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا") };
  }
}
