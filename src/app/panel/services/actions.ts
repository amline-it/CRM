"use server";

import { revalidatePath } from "next/cache";
import { toErrorResponse, AppError } from "@/lib/errors";
import { assertCsrf, requirePermission } from "@/auth/session";
import * as Catalog from "@/db/repos/catalog";
import * as Platform from "@/db/repos/platform";

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

export async function saveServiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("service.manage");
    const key = text(form, "key");
    const name = text(form, "name");
    const category = text(form, "category");
    const workflowKey = text(form, "workflowKey");
    if (!key || !name || !category || !workflowKey) return { error: "کلید، نام، دسته و گردش‌کار الزامی است" };
    if (!/^[a-z0-9_]+$/.test(key)) return { error: "کلید خدمت باید فقط شامل حروف کوچک انگلیسی، عدد و _ باشد" };

    const docsRaw = text(form, "requiredDocuments");
    Catalog.upsertService({
      key,
      name,
      category,
      workflowKey,
      description: text(form, "description"),
      price: number(form, "price") ?? 0,
      requiresSubscription: text(form, "requiresSubscription") === "true",
      requiresReferral: text(form, "requiresReferral") === "true",
      requiredDocuments: docsRaw ? docsRaw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : [],
      active: text(form, "active") === "false" ? false : true,
      sortOrder: number(form, "sortOrder") ?? undefined,
    });
    Platform.writeAudit({
      actorType: session.role,
      actorId: session.staff.id,
      actorName: session.staff.full_name,
      action: "service.save",
      entityType: "service",
      entityId: key,
      detail: { name, category, workflowKey },
    });
    revalidatePath("/panel/services");
    return { message: `خدمت «${name}» ذخیره شد` };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در ذخیره خدمت") };
  }
}

export async function toggleServiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("service.manage");
    const key = text(form, "key");
    if (!key) return { error: "خدمت مشخص نیست" };
    const service = Catalog.getServiceByKey(key);
    if (!service) throw new AppError("NOT_FOUND", "خدمت یافت نشد");
    Catalog.setServiceActive(key, !service.active);
    Platform.writeAudit({
      actorType: session.role,
      actorId: session.staff.id,
      actorName: session.staff.full_name,
      action: service.active ? "service.deactivate" : "service.activate",
      entityType: "service",
      entityId: key,
    });
    revalidatePath("/panel/services");
    return { message: service.active ? "خدمت غیرفعال شد" : "خدمت فعال شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در تغییر وضعیت خدمت") };
  }
}
