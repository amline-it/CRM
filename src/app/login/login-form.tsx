"use client";

import { useActionState } from "react";
import { loginAction, bootstrapAdminAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm({ csrf, ssoToken }: { csrf: string; ssoToken?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  if (ssoToken) {
    return (
      <form action={formAction}>
        <input type="hidden" name="_csrf" value={csrf} />
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
      <input type="hidden" name="_csrf" value={csrf} />
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
      <button type="submit" style={{ width: "100%" }} disabled={pending}>
        {pending ? "در حال ورود…" : "ورود به پنل"}
      </button>
    </form>
  );
}

export function BootstrapForm({ csrf }: { csrf: string }) {
  const [state, formAction, pending] = useActionState(bootstrapAdminAction, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="_csrf" value={csrf} />
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
