"use server";

import { revalidatePath } from "next/cache";
import { toErrorResponse, AppError } from "@/lib/errors";
import { assertCsrf, requirePermission } from "@/auth/session";
import * as Platform from "@/db/repos/platform";
import { clearDefinitionCache, guards, effects } from "@/domain/workflows";
import { validateDefinition } from "@/domain/engine/validate";
import type { WorkflowDefinition } from "@/domain/engine/types";
import { z } from "zod";

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

const WorkflowMeta = z.object({
  key: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1),
  states: z.array(z.object({ key: z.string().min(1), name: z.string().min(1) }).passthrough()).min(1),
  transitions: z.array(z.object({ key: z.string().min(1), from: z.union([z.string(), z.array(z.string())]), to: z.string() }).passthrough()).min(1),
  initial: z.string().optional(),
});

/** بارگذاری نسخه جدید تعریف گردش‌کار از JSON (فقط مدیر) */
export async function importWorkflowAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("workflow.manage");
    const raw = text(form, "definition");
    if (!raw) return { error: "متن JSON تعریف را وارد کنید" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: "JSON نامعتبر است" };
    }
    const meta = WorkflowMeta.safeParse(parsed);
    if (!meta.success) return { error: `ساختار تعریف معتبر نیست: ${meta.error.issues[0]?.message ?? "خطای نامشخص"}` };

    const issues = validateDefinition(parsed as WorkflowDefinition, { checkRegistries: true, guards, effects }).filter(
      (issue) => issue.level === "error",
    );
    if (issues.length) return { error: `تعریف معتبر نیست: ${issues.slice(0, 3).map((i) => i.message).join("؛ ")}` };

    Platform.upsertWorkflowDefinition({
      key: meta.data.key,
      version: meta.data.version,
      name: meta.data.name,
      definition: parsed,
    });
    clearDefinitionCache();
    Platform.writeAudit({
      actorType: session.role,
      actorId: session.staff.id,
      actorName: session.staff.full_name,
      action: "workflow.import",
      entityType: "workflow",
      entityId: `${meta.data.key}@v${meta.data.version}`,
      detail: { states: meta.data.states.length, transitions: meta.data.transitions.length },
    });
    revalidatePath("/panel/workflows");
    return { message: `تعریف «${meta.data.name}» نسخه ${meta.data.version} ذخیره شد` };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در بارگذاری تعریف") };
  }
}

export async function activateWorkflowAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("workflow.manage");
    const id = text(form, "workflowId");
    const active = text(form, "active") !== "false";
    if (!id) return { error: "تعریف مشخص نیست" };
    Platform.setWorkflowActive(id, active);
    Platform.writeAudit({
      actorType: session.role,
      actorId: session.staff.id,
      actorName: session.staff.full_name,
      action: active ? "workflow.activate" : "workflow.deactivate",
      entityType: "workflow",
      entityId: id,
    });
    revalidatePath("/panel/workflows");
    return { message: active ? "نسخه فعال شد" : "نسخه غیرفعال شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    if (err instanceof AppError) return { error: err.message };
    return { error: String(body.message ?? "خطا در تغییر وضعیت تعریف") };
  }
}
