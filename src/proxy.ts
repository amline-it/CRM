/**
 * پروکسی Next 16: تبدیل توکن نشست موجود در آدرس (?t=…) به هدر درخواست.
 *
 * چرا؟ در محیط‌هایی که کوکی ذخیره/ارسال نمی‌شود (پنل داخل iframe، مسدودسازی کوکی
 * شخص‌ثالث)، توکن نشست در آدرس صفحه نگه داشته می‌شود؛ اینجا آن را به هدر
 * X-Session-Ticket تبدیل می‌کنیم تا لایه احراز هویت آن را مثل کوکی ببیند.
 * توکن نامعتبر بی‌اثر است (اعتبارسنجی واقعی در src/auth/session.ts انجام می‌شود).
 */
import { NextResponse, type NextRequest } from "next/server";

const TICKET_QUERY = "t";
const TICKET_HEADER = "x-session-ticket";

export function proxy(request: NextRequest) {
  const ticket = request.nextUrl.searchParams.get(TICKET_QUERY);
  if (!ticket || !ticket.trim()) return NextResponse.next();

  const headers = new Headers(request.headers);
  if (!headers.get(TICKET_HEADER)) headers.set(TICKET_HEADER, ticket.trim());
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
