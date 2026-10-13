/**
 * لایه کمکی API عملیات کارمندی (`/api/v1/ops/*`).
 *
 * چرا API جدا از Server Action؟ برای عملیات کانبان (جابه‌جایی کارت، تغییر وضعیت،
 * ارجاع، پیام و اعلان) فرانت‌اند به پاسخ روشن سرور نیاز دارد تا تا **پیش از تأیید
 * سرور** وضعیت را قطعی نشان ندهد. این مسیرها همان نشست پنل را می‌خوانند و همه
 * بررسی‌های مجوز را سمت سرور انجام می‌دهند:
 *   ۱) نشست معتبر کارمند (کوکی یا هدر امضاشده)
 *   ۲) مجوز RBAC مربوط به عملیات
 *   ۳) برای درخواست‌های تغییردهنده: توکن CSRF در هدر `X-CSRF-Token`
 *   ۴) اختیاری: `Idempotency-Key` برای جلوگیری از آثار تکراری
 *
 * هیچ داده‌ای از این مسیرها در API سینک یا پاسخ‌های مشتری بازتاب داده نمی‌شود.
 */
import { NextResponse, type NextRequest } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { can, type Permission, type Role } from "@/auth/rbac";
import { assertCsrfHeader, getCurrentSession, type CurrentSession } from "@/auth/session";
import { CSRF_HEADER } from "@/auth/csrf";
import { ensureMigrated } from "@/db/migrate";
import * as Cases from "@/db/repos/cases";
import type { ActorContext } from "@/domain/engine/types";

export const OPS_API_HEADERS = { "Cache-Control": "no-store" } as const;

export function ok<T>(data: T, init?: { status?: number; headers?: Record<string, string> }) {
  return NextResponse.json({ ok: true, data }, { status: init?.status ?? 200, headers: { ...OPS_API_HEADERS, ...init?.headers } });
}

export function fail(err: unknown) {
  const { status, body } = toErrorResponse(err);
  return NextResponse.json(
    { ok: false, code: body.code, message: body.message, details: body.details, hint: body.hint },
    { status, headers: OPS_API_HEADERS },
  );
}

/** نشست معتبر کارمند؛ در غیر این صورت 401 با پیام فارسی */
export async function requireApiSession(permission?: Permission): Promise<CurrentSession> {
  ensureMigrated();
  const session = await getCurrentSession();
  if (!session) throw new AppError("UNAUTHORIZED", "برای دسترسی به این بخش باید وارد شوید");
  if (permission && !can(session.role, permission)) {
    throw new AppError("FORBIDDEN", "شما به این عملیات دسترسی ندارید");
  }
  return session;
}

/** بررسی CSRF برای درخواست‌های تغییردهنده (هدر امضاشده) */
export async function assertMutation(request: NextRequest): Promise<void> {
  await assertCsrfHeader(request.headers.get(CSRF_HEADER));
}

export function idempotencyKey(request: NextRequest): string | null {
  const raw = request.headers.get("idempotency-key") ?? request.headers.get("x-idempotency-key");
  const value = raw?.trim();
  if (!value) return null;
  if (value.length > 120) throw new AppError("VALIDATION", "کلید idempotency بیش از حد بلند است");
  return value;
}

export function actorOf(session: CurrentSession): ActorContext {
  return { type: session.role as Role, id: session.staff.id, name: session.staff.full_name };
}

/** بدنه JSON با محدودیت اندازه و پیام خطای فارسی */
export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 200_000) throw new AppError("VALIDATION", "بدنه درخواست بیش از حد بزرگ است");
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AppError("VALIDATION", "بدنه درخواست باید یک شیء JSON باشد");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("VALIDATION", "بدنه JSON نامعتبر است");
  }
}

/** پرونده واقعی یا 404 — جلوی سوءاستفاده از «تغییر شناسه در درخواست» را می‌گیرد */
export function findCaseOr404(caseId: string): Cases.CaseRow {
  const row = Cases.findCaseById(caseId);
  if (!row) throw new AppError("NOT_FOUND", "پرونده یافت نشد");
  return row;
}

export function asString(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}
