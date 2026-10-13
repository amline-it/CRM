import { redirect } from "next/navigation";
import { getCurrentSession, newCsrfToken, SESSION_COOKIE } from "@/auth/session";
import { ensureMigrated } from "@/db/migrate";
import * as People from "@/db/repos/people";
import { demoModeEnabled } from "@/auth/demo";
import { BootstrapForm, LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  ensureMigrated();
  const session = await getCurrentSession();
  if (session) redirect("/panel");
  // در حالت نمایش محلی (فقط پیش‌نمایش)، صفحه ورود غیرفعال است و مستقیم به پنل می‌رویم
  if (demoModeEnabled()) redirect("/panel");

  // توکن CSRF امضاشده و بدون‌حالت است؛ در همین رندر ساخته می‌شود (بدون نیاز به کوکی)
  const csrf = newCsrfToken();

  const params = await searchParams;
  const ssoToken = typeof params.sso === "string" && params.sso ? params.sso : undefined;

  const hasStaff = People.listStaff().length > 0;
  const sandboxHint = process.env.NODE_ENV !== "production";
  const ssoEnabled = process.env.SSO_ENABLED === "true";

  return (
    <div className="login-shell">
      <div className="login-card">
        <h1>CRM املاک</h1>
        <p className="sub">
          {hasStaff ? "ورود کارشناسان و مدیران" : "راه‌اندازی اولیه سامانه"}
        </p>
        {hasStaff ? (
          <LoginForm csrf={csrf} ssoToken={ssoEnabled ? ssoToken : undefined} />
        ) : (
          <BootstrapForm csrf={csrf} />
        )}
        {sandboxHint ? (
          <p className="small muted" style={{ marginTop: 16 }}>
            این پنل فقط برای کارکنان است. داده کاربران از سرور اصلی شما سینک می‌شود. راهنمای اتصال در فایل
            <span className="mono"> docs/sync-api.md </span>
            آمده است.
          </p>
        ) : null}
        {hasStaff && !ssoEnabled ? (
          <p className="small muted" style={{ marginTop: 12 }}>
            ورود سازمانی (SSO) خاموش است. برای فعال‌سازی، <span className="mono">SSO_ENABLED=true</span> و{" "}
            <span className="mono">SSO_JWT_SECRET</span> را در فایل محیطی تنظیم کنید و سرور اصلی را به آدرس{" "}
            <span className="mono">
              /login?sso=&lt;JWT&gt;
            </span>{" "}
            هدایت کنید.
          </p>
        ) : null}
        <p className="small muted" style={{ marginTop: 8 }}>
          برای خروج امن، همیشه از دکمه «خروج» استفاده کنید. کوکی جلسه: <span className="mono">{SESSION_COOKIE}</span>
        </p>
      </div>
    </div>
  );
}
