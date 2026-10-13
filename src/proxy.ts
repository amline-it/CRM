/**
 * پروکسی (جایگزین middleware در Next 16): تضمین وجود توکن CSRF روی همه پاسخ‌ها.
 * (بررسی کامل جلسه در layout پنل انجام می‌شود؛ اینجا فقط لایه سبک است.)
 */
import { NextResponse, type NextRequest } from "next/server";

/** هم‌نام با CSRF_COOKIE در src/auth/csrf.ts — برای سازگاری با runtime لبه، بدون import */
const CSRF_COOKIE = "crm_csrf";

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  if (!request.cookies.get(CSRF_COOKIE)?.value) {
    response.cookies.set(CSRF_COOKIE, randomToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
