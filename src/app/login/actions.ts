"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { login, logout, newCsrfToken, sessionCookieOptions } from "@/auth/session";
import { CSRF_FIELD, verifyCsrfToken } from "@/auth/csrf";
import { ensureMigrated } from "@/db/migrate";
import { verifySsoToken } from "@/auth/jwt";
import * as People from "@/db/repos/people";
import * as Platform from "@/db/repos/platform";
import { hashPassword } from "@/auth/password";

export interface LoginState {
  error?: string;
  username?: string;
  /** توکن تازه CSRF که در صورت خطا به فرم برگردانده می‌شود تا کاربر مجبور به رفرش نباشد */
  csrf?: string;
  /** توکن نشست برای مسیر بدون کوکی (مرورگر آن را در localStorage و سرویس‌ورکر نگه می‌دارد) */
  ticket?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  try {
    return await loginActionInner(_prev, formData);
  } catch (err) {
    console.error("[loginAction] خطای غیرمنتظره:", err);
    return { error: `خطای داخلی: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function loginActionInner(_prev: LoginState, formData: FormData): Promise<LoginState> {
  ensureMigrated();
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const csrf = String(formData.get(CSRF_FIELD) ?? "");
  if (!verifyCsrfToken(csrf).ok) {
    // توکن تازه برمی‌گردانیم تا ارسال بعدی بدون رفرش صفحه کار کند
    return { error: "اعتبار فرم منقضی شده بود؛ لطفاً دوباره تلاش کنید", username, csrf: newCsrfToken() };
  }
  if (!username || !password) {
    return { error: "نام کاربری و رمز عبور را وارد کنید", username };
  }

  // ورود با SSO (در صورت فعال بودن و ارسال توکن)
  const ssoToken = String(formData.get("sso_token") ?? "");
  if (ssoToken) {
    const claims = await verifySsoToken(ssoToken);
    const ssoUsername = claims?.username ?? claims?.sub;
    if (claims && ssoUsername) {
      const staff = People.findStaffByUsername(String(ssoUsername).toLowerCase()) ?? People.findStaffBySsoSubject(String(claims.sub ?? ""));
      if (staff?.active) {
        People.touchStaffLogin(staff.id);
        Platform.writeAudit({
          actorType: staff.role,
          actorId: staff.id,
          actorName: staff.full_name,
          action: "auth.login.sso",
          entityType: "staff",
          entityId: staff.id,
        });
        const { signSessionToken, tokenHash } = await import("@/auth/jwt");
        const token = await signSessionToken({ sub: staff.id, role: staff.role as "staff" | "admin", name: staff.full_name });
        People.createSession({ staffId: staff.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString() });
        const jar = await (await import("next/headers")).cookies();
        jar.set("crm_session", token, sessionCookieOptions(new Date(Date.now() + 12 * 3600_000)));
        return { ticket: token };
      }
    }
  }

  const headerList = await headers();
  const result = await login({
    username,
    password,
    userAgent: headerList.get("user-agent"),
    ip: headerList.get("x-forwarded-for") ?? null,
  });
  if (!result.ok) return { error: result.message, username };
  // توکن نشست به کلاینت برمی‌گردد تا در مسیر بدون کوکی هم کار کند؛
  // سپس کلاینت خودش به پنل می‌رود (پس از آماده‌شدن سرویس‌ورکر).
  const jar = await (await import("next/headers")).cookies();
  const token = jar.get("crm_session")?.value;
  return { ticket: token ?? undefined };
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}

/** ایجاد اولین مدیر — فقط وقتی هیچ کارمندی وجود ندارد (راه‌اندازی اولیه) */
export async function bootstrapAdminAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  ensureMigrated();
  const csrf = String(formData.get(CSRF_FIELD) ?? "");
  if (!verifyCsrfToken(csrf).ok) {
    return { error: "اعتبار فرم منقضی شده بود؛ لطفاً دوباره تلاش کنید", csrf: newCsrfToken() };
  }
  if (People.listStaff().length > 0) {
    return { error: "پیش‌تر کارمند ثبت شده است؛ از صفحه ورود استفاده کنید" };
  }
  const fullName = String(formData.get("full_name") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!fullName || !username || password.length < 6) {
    return { error: "نام، نام کاربری و رمز حداقل ۶ کاراکتری لازم است" };
  }
  People.createStaff({ username, fullName, role: "admin", passwordHash: hashPassword(password) });
  Platform.writeAudit({ actorType: "system", action: "staff.bootstrap", entityType: "staff", entityId: username });
  redirect("/login");
}
