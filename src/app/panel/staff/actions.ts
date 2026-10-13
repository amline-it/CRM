"use server";

import { revalidatePath } from "next/cache";
import { toErrorResponse, AppError } from "@/lib/errors";
import { assertCsrf, requirePermission } from "@/auth/session";
import { hashPassword } from "@/auth/password";
import * as People from "@/db/repos/people";
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

function audit(session: { role: "staff" | "admin"; staff: { id: string; full_name: string } }, action: string, entityId: string, detail?: Record<string, unknown>) {
  Platform.writeAudit({
    actorType: session.role,
    actorId: session.staff.id,
    actorName: session.staff.full_name,
    action,
    entityType: "staff",
    entityId,
    detail,
  });
}

export async function createStaffAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("staff.manage");
    const username = text(form, "username");
    const fullName = text(form, "fullName");
    const password = text(form, "password");
    const role = (text(form, "role") ?? "staff") as "staff" | "admin";
    if (!username || !fullName || !password) return { error: "نام کاربری، نام کامل و رمز عبور الزامی است" };
    if (!/^[a-zA-Z0-9._-]{3,}$/.test(username)) return { error: "نام کاربری باید حداقل ۳ کاراکتر انگلیسی/عدد باشد" };
    if (People.findStaffByUsername(username)) return { error: "این نام کاربری قبلاً ثبت شده است" };

    const id = People.createStaff({ username, fullName, role, passwordHash: hashPassword(password) });
    audit(session, "staff.create", id, { username, role });
    revalidatePath("/panel/staff");
    return { message: `کارشناس «${fullName}» ایجاد شد` };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در ایجاد کارشناس") };
  }
}

export async function updateStaffAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("staff.manage");
    const staffId = text(form, "staffId");
    if (!staffId) return { error: "کارشناس مشخص نیست" };
    const target = People.findStaffById(staffId);
    if (!target) throw new AppError("NOT_FOUND", "کارشناس یافت نشد");

    const role = text(form, "role") as "staff" | "admin" | null;
    const active = text(form, "active");
    if (target.id === session.staff.id && ((role && role !== target.role) || active === "false")) {
      return { error: "امکان تغییر نقش یا غیرفعال‌سازی حساب خودتان وجود ندارد" };
    }
    if (target.role === "admin" && role === "staff" && People.countAdmins() <= 1) {
      return { error: "حداقل یک مدیر باید فعال بماند" };
    }

    People.updateStaff(staffId, {
      fullName: text(form, "fullName") ?? undefined,
      role: role ?? undefined,
      active: active === null ? undefined : active === "true",
    });
    audit(session, "staff.update", staffId, { role, active });
    revalidatePath("/panel/staff");
    return { message: "اطلاعات کارشناس به‌روزرسانی شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در به‌روزرسانی کارشناس") };
  }
}

export async function resetStaffPasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("staff.manage");
    const staffId = text(form, "staffId");
    const password = text(form, "password");
    if (!staffId || !password) return { error: "کارشناس و رمز جدید الزامی است" };
    People.updateStaff(staffId, { passwordHash: hashPassword(password) });
    People.revokeStaffSessions(staffId);
    audit(session, "staff.reset_password", staffId);
    revalidatePath("/panel/staff");
    return { message: "رمز عبور تغییر کرد و نشست‌های قبلی بسته شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در تغییر رمز عبور") };
  }
}

export async function revokeStaffSessionsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertCsrf(form);
    const session = await requirePermission("staff.manage");
    const staffId = text(form, "staffId");
    if (!staffId) return { error: "کارشناس مشخص نیست" };
    People.revokeStaffSessions(staffId);
    audit(session, "staff.revoke_sessions", staffId);
    revalidatePath("/panel/staff");
    return { message: "همه نشست‌های این کارشناس بسته شد" };
  } catch (err) {
    const { body } = toErrorResponse(err);
    return { error: String(body.message ?? "خطا در بستن نشست‌ها") };
  }
}
