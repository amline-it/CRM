/**
 * خروج کامل: باطل‌کردن نشست در سرور + پاک‌کردن همه‌چیز در مرورگر.
 *
 * چرا این مسیر لازم است؟ در پنل داخل iframe ممکن است کوکی ذخیره نشود و توکن نشست
 * در حافظه/آدرس مرورگر بماند. این صفحه:
 *   ۱) نشست‌های سرور (کوکی و توکن هدر) را باطل می‌کند
 *   ۲) با هدر Clear-Site-Data کوکی/ذخیره‌سازی/کش همین دامنه را در مرورگر پاک می‌کند
 *   ۳) با جاوااسکریپت توکن محلی و سرویس‌ورکر قدیمی را هم پاک می‌کند
 *   ۴) به صفحه ورود برمی‌گردد
 */
import { NextResponse } from "next/server";
import { logout } from "@/auth/session";

export const dynamic = "force-dynamic";

const PAGE = `<!doctype html>
<html lang="fa" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>خروج از پنل</title>
    <style>
      body { font-family: Vazirmatn, Tahoma, sans-serif; background: #f5f7fb; color: #1f2937;
             display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
      .card { background: #fff; border-radius: 14px; padding: 28px 32px; box-shadow: 0 10px 30px rgba(15,23,42,.08);
              text-align: center; max-width: 420px; }
      h1 { font-size: 18px; margin: 0 0 8px; }
      p { color: #64748b; font-size: 14px; margin: 0 0 16px; }
      a { color: #1c5bd8; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>از پنل خارج شدید</h1>
      <p>نشست شما باطل شد و داده‌های محلی مرورگر پاک شدند.</p>
      <a href="/login">ورود دوباره به پنل</a>
    </div>
    <script>
      try { window.localStorage.removeItem("crm_session_ticket"); window.localStorage.clear(); } catch (e) {}
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
          navigator.serviceWorker.getRegistrations().then(function (list) {
            list.forEach(function (registration) {
              var script = (registration.active && registration.active.scriptURL) ||
                           (registration.waiting && registration.waiting.scriptURL) ||
                           (registration.installing && registration.installing.scriptURL) || "";
              if (script.indexOf("session-worker") >= 0) registration.unregister();
            });
          });
        }
      } catch (e) {}
      setTimeout(function () { window.location.replace("/login"); }, 700);
    </script>
  </body>
</html>`;

export async function GET() {
  await logout();
  return new NextResponse(PAGE, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      // مرورگر کوکی، حافظه محلی و کش همین دامنه را پاک می‌کند
      "clear-site-data": '"cookies", "storage", "cache"',
    },
  });
}
