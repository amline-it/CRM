/**
 * جلسه کارمندان — سمت سرور (Next): کوکی HttpOnly + JWT + ردیف جلسه در دیتابیس.
 * ورود فقط برای کارشناس/مدیر؛ کاربران نهایی هرگز وارد پنل نمی‌شوند.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import * as People from "@/db/repos/people";
import * as Platform from "@/db/repos/platform";
import { assertCan, can, type Permission, type Role } from "@/auth/rbac";
import { CSRF_COOKIE, CSRF_FIELD, createCsrfToken, safeEqual } from "@/auth/csrf";
import { verifyPassword } from "@/auth/password";
import { signSessionToken, tokenHash, verifySessionToken } from "@/auth/jwt";

export const SESSION_COOKIE = "crm_session";

export interface CurrentSession {
  staff: People.StaffRow;
  role: Role;
  sessionId: string;
  expiresAt: string;
}

export interface LoginInput {
  username: string;
  password: string;
  userAgent?: string | null;
  ip?: string | null;
  ttlHours?: number;
}

export async function login(input: LoginInput): Promise<{ ok: true; session: CurrentSession } | { ok: false; message: string }> {
  const staff = People.findStaffByUsername(input.username.trim().toLowerCase());
  if (!staff) return { ok: false, message: "نام کاربری یا رمز عبور نادرست است" };
  if (!staff.active) return { ok: false, message: "حساب شما غیرفعال است؛ با مدیر تماس بگیرید" };
  if (!verifyPassword(input.password, staff.password_hash)) {
    return { ok: false, message: "نام کاربری یا رمز عبور نادرست است" };
  }

  const ttlHours = input.ttlHours ?? 12;
  const token = await signSessionToken({ sub: staff.id, role: staff.role as Role, name: staff.full_name }, ttlHours);
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();
  const sessionId = People.createSession({
    staffId: staff.id,
    tokenHash: tokenHash(token),
    expiresAt,
    userAgent: input.userAgent ?? null,
    ip: input.ip ?? null,
  });
  People.touchStaffLogin(staff.id);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });

  Platform.writeAudit({
    actorType: staff.role,
    actorId: staff.id,
    actorName: staff.full_name,
    action: "auth.login",
    entityType: "staff",
    entityId: staff.id,
    ip: input.ip ?? null,
  });

  return { ok: true, session: { staff, role: staff.role as Role, sessionId, expiresAt } };
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) People.revokeSession(tokenHash(token));
  jar.delete(SESSION_COOKIE);
}

/** جلسه فعلی بدون ریدایرکت (برای صفحاتی که حالت مهمان هم دارند) */
export async function getCurrentSession(): Promise<CurrentSession | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  const session = People.findSessionByTokenHash(tokenHash(token));
  if (!session || session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;
  const staff = People.findStaffById(claims.sub);
  if (!staff || !staff.active) return null;
  return { staff, role: staff.role as Role, sessionId: session.id, expiresAt: session.expires_at };
}

/** نیازمند ورود — در غیر این صورت به صفحه ورود هدایت می‌شود */
export async function requireSession(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

export async function requirePermission(permission: Permission): Promise<CurrentSession> {
  const session = await requireSession();
  if (!can(session.role, permission)) {
    throw new AppError("FORBIDDEN", "شما به این بخش دسترسی ندارید");
  }
  return session;
}

export function assertPermission(session: CurrentSession, permission: Permission): void {
  assertCan(session.role, permission);
}

/* ── CSRF ─────────────────────────────────────────────────────────── */

/** توکن CSRF فعلی برای قراردادن در فرم‌ها (خواندنی؛ مقدار در middleware ست می‌شود) */
export async function getCsrfToken(): Promise<string> {
  const jar = await cookies();
  return jar.get(CSRF_COOKIE)?.value ?? "";
}

/** برای مسیرهای API/اکشن‌ها: توکن تازه (در نبود کوکی) */
export function newCsrfToken(): string {
  return createCsrfToken();
}

export async function assertCsrf(formData: FormData | null): Promise<void> {
  const jar = await cookies();
  const expected = jar.get(CSRF_COOKIE)?.value ?? null;
  const provided = formData ? String(formData.get(CSRF_FIELD) ?? "") : null;
  if (!safeEqual(expected, provided)) {
    throw new AppError("FORBIDDEN", "اعتبار فرم منقضی شده است؛ صفحه را دوباره بارگذاری کنید");
  }
}

export async function assertCsrfHeader(headerValue: string | null): Promise<void> {
  const jar = await cookies();
  const expected = jar.get(CSRF_COOKIE)?.value ?? null;
  if (!safeEqual(expected, headerValue)) {
    throw new AppError("FORBIDDEN", "توکن CSRF نامعتبر است");
  }
}
