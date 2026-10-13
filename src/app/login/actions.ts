"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { login, logout, getCsrfToken } from "@/auth/session";
import { CSRF_FIELD, safeEqual } from "@/auth/csrf";
import { ensureMigrated } from "@/db/migrate";
import { verifySsoToken } from "@/auth/jwt";
import * as People from "@/db/repos/people";
import * as Platform from "@/db/repos/platform";
import { hashPassword } from "@/auth/password";

export interface LoginState {
  error?: string;
  username?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  ensureMigrated();
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const csrf = String(formData.get(CSRF_FIELD) ?? "");
  const expected = await getCsrfToken();
  if (!safeEqual(expected, csrf)) {
    return { error: "اعتبار فرم منقضی شده است؛ صفحه را دوباره بارگذاری کنید", username };
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
        jar.set("crm_session", token, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
        redirect("/panel");
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
  redirect("/panel");
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}

/** ایجاد اولین مدیر — فقط وقتی هیچ کارمندی وجود ندارد (راه‌اندازی اولیه) */
export async function bootstrapAdminAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  ensureMigrated();
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
