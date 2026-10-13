"use server";

import { revalidatePath } from "next/cache";
import { toErrorResponse } from "@/lib/errors";
import { assertCsrf, requirePermission } from "@/auth/session";
import * as Platform from "@/db/repos/platform";
import { dispatchDueWebhooks, pullOnce, type IngestEntity } from "@/services/sync";
import { seedDefinitions } from "@/services/definitions";

export interface ActionState {
  error?: string;
  message?: string;
}

const ENTITIES: IngestEntity[] = ["users", "contracts", "listings", "requirements"];

function text(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (value === null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

/** واکشی دستی از سرور اصلی (pull) */
export async function pullNowAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("sync.manage");
    const entity = text(form, "entity");
    const targets = entity && ENTITIES.includes(entity as IngestEntity) ? [entity as IngestEntity] : ENTITIES;
    const outcomes: string[] = [];
    let failures = 0;
    for (const target of targets) {
      const outcome = await pullOnce(target);
      outcomes.push(`${target}: ${outcome.ok ? "موفق" : "ناموفق"} — ${outcome.message}`);
      if (!outcome.ok) failures += 1;
    }
    Platform.writeAudit({
      actorType: session.role,
      actorId: session.staff.id,
      actorName: session.staff.full_name,
      action: "sync.pull",
      entityType: "sync",
      entityId: targets.join(","),
      detail: { failures, outcomes },
    });
    revalidatePath("/panel/sync");
    return {
      error: failures === targets.length ? outcomes.join(" | ") : undefined,
      message: failures === 0 ? `واکشی انجام شد — ${outcomes.join(" | ")}` : outcomes.join(" | "),
    };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در واکشی") };
  }
}

/** ارسال وب‌هوک‌های سررسیده به سرور اصلی */
export async function dispatchWebhooksAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(_form);
    const session = await requirePermission("sync.manage");
    const results = await dispatchDueWebhooks(50);
    const ok = results.filter((r) => r.ok).length;
    Platform.writeAudit({
      actorType: session.role,
      actorId: session.staff.id,
      actorName: session.staff.full_name,
      action: "sync.dispatch_webhooks",
      entityType: "sync",
      entityId: "webhooks",
      detail: { total: results.length, ok },
    });
    revalidatePath("/panel/sync");
    if (!results.length) return { message: "وب‌هوک سررسیده‌ای برای ارسال وجود ندارد" };
    return {
      message: `${results.length} وب‌هوک پردازش شد؛ موفق: ${ok}، ناموفق: ${results.length - ok}`,
      error: ok === results.length ? undefined : results.filter((r) => !r.ok).map((r) => `${r.event}: ${r.error ?? "خطا"}`).join(" | "),
    };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در ارسال وب‌هوک‌ها") };
  }
}

/** ثبت تنظیمات سینک (آدرس واکشی/وب‌هوک و کلیدها از فایل env خوانده می‌شوند، اینها در دیتابیس) */
export async function saveSyncSettingsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("sync.manage");
    const pullUrl = text(form, "pullUrl");
    const webhookUrl = text(form, "webhookUrl");
    const pullEnabled = text(form, "pullEnabled") === "true";

    Platform.setSetting("sync.pullUrl", pullUrl ?? "");
    Platform.setSetting("sync.webhookUrl", webhookUrl ?? "");
    Platform.setSetting("sync.pullEnabled", pullEnabled);
    Platform.writeAudit({
      actorType: session.role,
      actorId: session.staff.id,
      actorName: session.staff.full_name,
      action: "sync.save_settings",
      entityType: "sync",
      entityId: "settings",
      detail: { pullUrl, webhookUrl, pullEnabled },
    });
    revalidatePath("/panel/sync");
    return { message: "تنظیمات سینک ذخیره شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در ذخیره تنظیمات") };
  }
}

/** ثبت تعریف‌های گردش‌کار و خدمات پیش‌فرض از فایل‌ها در دیتابیس */
export async function seedDefinitionsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("sync.manage");
    const report = seedDefinitions();
    Platform.writeAudit({
      actorType: session.role,
      actorId: session.staff.id,
      actorName: session.staff.full_name,
      action: "workflow.seed",
      entityType: "workflow",
      entityId: "all",
      detail: report,
    });
    revalidatePath("/panel/workflows");
    revalidatePath("/panel/sync");
    revalidatePath("/panel/services");
    return {
      message: `${report.definitions.length} تعریف ثبت شد (${report.definitions
        .map((d) => `${d.key}@v${d.version}`)
        .join("، ")}) و ${report.services.length} خدمت جدید ساخته شد`,
    };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در بارگذاری تعریف‌ها") };
  }
}

/** بازگرداندن یک وب‌هوک مرده/ناموفق به صف ارسال */
export async function retryWebhookAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("sync.manage");
    const id = text(form, "webhookId");
    if (!id) return { error: "وب‌هوک مشخص نیست" };
    Platform.retryWebhook(id);
    Platform.writeAudit({
      actorType: session.role,
      actorId: session.staff.id,
      actorName: session.staff.full_name,
      action: "sync.webhook_retry",
      entityType: "webhook",
      entityId: id,
    });
    revalidatePath("/panel/sync");
    return { message: "وب‌هوک به صف بازگشت؛ با «ارسال وب‌هوک‌ها» تلاش می‌شود" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در بازگرداندن وب‌هوک") };
  }
}

/** پاک‌کردن وب‌هوک‌های مرده (بعد از ۵ تلاش ناموفق) */
export async function purgeDeadWebhooksAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("sync.manage");
    const dead = Platform.listWebhooks(500).filter((hook) => hook.status === "dead");
    const removed = Platform.deleteWebhooks(dead.map((hook) => hook.id));
    Platform.writeAudit({
      actorType: session.role,
      actorId: session.staff.id,
      actorName: session.staff.full_name,
      action: "sync.purge_dead_webhooks",
      entityType: "webhook",
      entityId: "dead",
      detail: { removed },
    });
    revalidatePath("/panel/sync");
    return { message: removed ? `${removed} وب‌هوک مرده پاک شد` : "وب‌هوک مرده‌ای وجود ندارد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در پاک‌سازی") };
  }
}
