"use client";

import { useActionState, useEffect, useState } from "react";
import { loginAction, bootstrapAdminAction, type LoginState } from "./actions";
import { getSessionBridge, saveSessionTicket } from "@/components/session-bridge";

const initialState: LoginState = {};

export function LoginForm({ csrf, ssoToken }: { csrf: string; ssoToken?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [entering, setEntering] = useState(false);
  // اگر اکشن توکن تازه برگرداند (مثلاً بعد از انقضا)، همان استفاده می‌شود
  const token = state.csrf ?? csrf;

  // پس از ورود موفق، همیشه با «توکن در آدرس» به پنل می‌رویم:
  //  - اگر مرورگر کوکی را نگه دارد، خود پنل توکن را از آدرس پاک می‌کند (آدرس تمیز).
  //  - اگر کوکی مسدود باشد (iframe/مرورگر سخت‌گیر)، همین توکن نشست را حفظ می‌کند.
  // ناوبری کامل صفحه است (نه SPA) تا توکن در همان درخواست سند حضور داشته باشد.
  useEffect(() => {
    if (!state.ticket) return;
    setEntering(true);
    saveSessionTicket(state.ticket, true);
    const target = getSessionBridge()?.decorateUrl("/panel") ?? "/panel";
    window.location.assign(target);
  }, [state.ticket]);
  if (ssoToken) {
    return (
      <form action={formAction}>
        <input type="hidden" name="_csrf" value={token} />
        <input type="hidden" name="sso_token" value={ssoToken} />
        <input type="hidden" name="username" value="" />
        <input type="hidden" name="password" value="" />
        {state.error ? <div className="alert error">{state.error}</div> : null}
        <div className="alert info">توکن ورود سازمانی از سرور اصلی دریافت شد؛ برای ادامه تأیید کنید.</div>
        <button type="submit" style={{ width: "100%" }} disabled={pending}>
          {pending ? "در حال ورود…" : "ورود با حساب سرور اصلی"}
        </button>
      </form>
    );
  }
  return (
    <form action={formAction}>
      <input type="hidden" name="_csrf" value={token} />
      {state.error ? <div className="alert error">{state.error}</div> : null}
      <div className="field">
        <label htmlFor="username">نام کاربری</label>
        <input id="username" name="username" autoComplete="username" defaultValue={state.username ?? ""} required />
      </div>
      <div className="field">
        <label htmlFor="password">رمز عبور</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <input type="hidden" name="sso_token" value="" />
      <button type="submit" style={{ width: "100%" }} disabled={pending || entering}>
        {pending ? "در حال ورود…" : entering ? "ورود به پنل…" : "ورود به پنل"}
      </button>
    </form>
  );
}

export function BootstrapForm({ csrf }: { csrf: string }) {
  const [state, formAction, pending] = useActionState(bootstrapAdminAction, initialState);
  const bootstrapToken = state.csrf ?? csrf;
  return (
    <form action={formAction}>
      <input type="hidden" name="_csrf" value={bootstrapToken} />
      <div className="alert info">
        هنوز هیچ کارمندی ثبت نشده است. ابتدا حساب مدیر را بسازید تا بتوانید وارد پنل شوید.
      </div>
      {state.error ? <div className="alert error">{state.error}</div> : null}
      <div className="field">
        <label htmlFor="full_name">نام و نام خانوادگی</label>
        <input id="full_name" name="full_name" required />
      </div>
      <div className="field">
        <label htmlFor="username">نام کاربری</label>
        <input id="username" name="username" autoComplete="username" required />
      </div>
      <div className="field">
        <label htmlFor="password">رمز عبور (حداقل ۶ کاراکتر)</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={6} />
      </div>
      <button type="submit" style={{ width: "100%" }} disabled={pending}>
        {pending ? "در حال ساخت…" : "ساخت حساب مدیر"}
      </button>
    </form>
  );
}
