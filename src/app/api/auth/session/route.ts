import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, getCurrentSession, sessionFromToken, ticketFromHeaders } from "@/auth/session";
import { ensureMigrated } from "@/db/migrate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * وضعیت/باطل‌کردن نشست برای مسیر بدون کوکی.
 * GET  → آیا توکن معتبر است؟ (برای بازگرداندن کاربر به پنل وقتی کوکی مسدود است)
 * DELETE → خروج: باطل‌کردن ردیف نشست + پاک‌کردن کوکی
 */
export async function GET(request: NextRequest) {
  ensureMigrated();
  const ticket = ticketFromHeaders(request.headers) ?? request.cookies.get(SESSION_COOKIE)?.value ?? null;
  // اگر توکنی نبود/نامعتبر بود، از منطق مشترک نشست استفاده می‌کنیم
  // (کوکی، توکن هدر و در حالت نمایش محلی، نشست نمایشی)
  const session = (await sessionFromToken(ticket)) ?? (await getCurrentSession());
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    staff: { id: session.staff.id, name: session.staff.full_name, role: session.role },
    expiresAt: session.expiresAt,
  });
}

export async function DELETE(request: NextRequest) {
  ensureMigrated();
  const ticket = ticketFromHeaders(request.headers) ?? request.cookies.get(SESSION_COOKIE)?.value ?? null;
  if (ticket) {
    const { tokenHash } = await import("@/auth/jwt");
    const People = await import("@/db/repos/people");
    try {
      People.revokeSession(tokenHash(ticket));
    } catch {
      /* توکن نامعتبر */
    }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
