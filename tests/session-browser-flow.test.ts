/**
 * شبیه‌سازی کامل مرورگر (بدون نیاز به مرورگر واقعی) روی سرور در حال اجرا.
 *
 * چرا؟ باگ اصلی این بود که وصلهٔ fetch روی window واقعی نمی‌نشست و روتر Next
 * درخواست‌های خودش را بدون توکن می‌فرستاد؛ نتیجه: پرت‌شدن به صفحه ورود. این آزمون
 * دقیقاً همان مسیر کاربر را با کد واقعی پل نشست و HTTP واقعی بازسازی می‌کند:
 *
 *   ورود از فرم → ناوبری کامل به /panel?t=… → ناوبری درون‌برنامه‌ای بدون کوکی
 *
 * اجرا:  BROWSER_FLOW_BASE=http://127.0.0.1:3000 npx vitest run tests/session-browser-flow.test.ts
 * اگر متغیر تنظیم نشود، آزمون رد می‌شود (در محیط CI بدون سرور هم سبز می‌ماند).
 */
import { describe, it, expect } from "vitest";
import { createSessionBridge, createWindowScope, type WindowLike } from "@/components/session-bridge-core";

const BASE = process.env.BROWSER_FLOW_BASE ?? "";
const describeIfServer = BASE ? describe : describe.skip;

const TICKET_PATTERN = /eyJhbGciOiJIUzI1NiJ9[A-Za-z0-9_.-]+/;

interface Browser {
  win: WindowLike & { fetch: typeof globalThis.fetch };
  jar: Map<string, string>;
  navigations: string[];
  currentUrl: () => string;
  loadDocument: (url: string) => Promise<{ status: number; body: string; url: string; bounced: boolean }>;
}

/** مرورگر جعلی: کوکی‌ها می‌توانند مسدود باشند، ناوبری‌ها ثبت می‌شوند */
function makeBrowser(options: { cookiesAllowed: boolean }): Browser {
  const jar = new Map<string, string>();
  const navigations: string[] = [];
  let url = `${BASE}/login`;

  const absolute = (target: string) => new URL(target, url).href;

  const win = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const resolved = absolute(target);
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      // مرورگر کوکی‌های همین دامنه را می‌فرستد؛ اگر مسدود باشند هیچ کوکی‌ای نمی‌رود
      if (options.cookiesAllowed && jar.size > 0) {
        headers.set("cookie", [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "));
      }
      const response = await fetch(resolved, { ...init, headers, redirect: "manual" });
      if (options.cookiesAllowed) {
        for (const raw of response.headers.getSetCookie?.() ?? []) {
          const [pair] = raw.split(";");
          const index = pair.indexOf("=");
          if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
        }
      }
      return response;
    }) as typeof globalThis.fetch,
    location: {
      get href() {
        return url;
      },
      origin: BASE,
      assign: (target: string) => {
        url = absolute(target);
        navigations.push(url);
      },
      replace: (target: string) => {
        url = absolute(target);
        navigations.push(`replace:${url}`);
      },
    },
    history: {
      pushState(_data: unknown, _title: string, target?: string | URL | null) {
        if (target !== undefined && target !== null) url = absolute(String(target));
      },
      replaceState(_data: unknown, _title: string, target?: string | URL | null) {
        if (target !== undefined && target !== null) url = absolute(String(target));
      },
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    } as unknown as Storage,
  };

  /** بارگذاری یک سند کامل، با دنبال‌کردن ریدایرکت‌ها (مثل مرورگر) */
  async function loadDocument(target: string) {
    let current = absolute(target);
    let bounced = false;
    for (let hop = 0; hop < 5; hop += 1) {
      url = current;
      const response = await win.fetch(current, { headers: { accept: "text/html" } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        current = absolute(location);
        if (current.includes("/login")) bounced = true;
        continue;
      }
      return { status: response.status, body: await response.text(), url: current, bounced };
    }
    return { status: 0, body: "", url: current, bounced };
  }

  return { win, jar, navigations, currentUrl: () => url, loadDocument };
}

/** استخراج فیلدهای مخفی فرم ورود (همان کاری که مرورگر هنگام ارسال فرم می‌کند) */
function hiddenFields(html: string): Record<string, string> {
  const form = html.match(/<form[^>]*>[\s\S]*?<\/form>/)?.[0] ?? html;
  const fields: Record<string, string> = {};
  const pattern = /<input[^>]*name="([^"]+)"[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(form))) {
    const tag = match[0];
    const name = match[1];
    if (!name.startsWith("$ACTION") && name !== "_csrf") continue;
    const value = tag.match(/value="([^"]*)"/)?.[1] ?? "";
    fields[name] = value
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
  return fields;
}

/** ورود با نام کاربری/رمز عبور و برگرداندن توکن نشست (بدون هیچ کوکی روی سرور) */
async function loginAndGetTicket(browser: Browser): Promise<string> {
  const page = await fetch(`${BASE}/login`).then((response) => response.text());
  const form = new FormData();
  for (const [key, value] of Object.entries(hiddenFields(page))) form.set(key, value);
  form.set("username", "admin");
  form.set("password", "Admin@1234");
  form.set("sso_token", "");
  const response = await fetch(`${BASE}/login`, { method: "POST", body: form, redirect: "manual" });
  const body = await response.text();
  return body.match(TICKET_PATTERN)?.[0] ?? "";
}

describeIfServer("مسیر کامل کاربر در مرورگر (شبیه‌سازی)", () => {
  for (const cookiesAllowed of [false, true]) {
    const label = cookiesAllowed ? "با کوکی" : "بدون هیچ کوکی (پنل داخل iframe)";

    it(`${label}: ورود → پنل → ناوبری درون‌برنامه‌ای بدون بازگشت به ورود`, async () => {
      const browser = makeBrowser({ cookiesAllowed });
      const bridge = createSessionBridge(createWindowScope(browser.win));

      // ۱) ورود از فرم
      const ticket = await loginAndGetTicket(browser);
      expect(ticket).not.toBe("");

      // ۲) همان کاری که فرم ورود انجام می‌دهد: توکن در حافظه + ناوبری کامل با ?t=
      bridge.activate(ticket, { keepInUrl: true });
      browser.win.location.assign(bridge.decorateUrl("/panel"));
      expect(browser.currentUrl()).toContain("t=");

      const panel = await browser.loadDocument(browser.currentUrl());
      expect(panel.bounced).toBe(false);
      expect(panel.status).toBe(200);
      expect(panel.body.length).toBeGreaterThan(1000);

      // ۳) ناوبری درون‌برنامه‌ای: روتر Next مستقیماً window.fetch را صدا می‌زند
      const cases = await browser.win.fetch(`${BASE}/panel/cases`);
      expect(cases.status).toBe(200);
      const tasks = await browser.win.fetch("/panel/tasks");
      expect(tasks.status).toBe(200);

      // ۴) همین درخواست بدون توکن باید رد شود (یعنی آزمون واقعاً معنا دارد)
      const anonymous = await bridge.fetchWithoutTicket(`${BASE}/panel/cases`);
      expect(anonymous.status).not.toBe(200);
    });
  }

  it("رفرش کامل داخل پنل، نشست را از دست نمی‌دهد (بدون کوکی)", async () => {
    const browser = makeBrowser({ cookiesAllowed: false });
    const bridge = createSessionBridge(createWindowScope(browser.win));
    const ticket = await loginAndGetTicket(browser);
    bridge.activate(ticket, { keepInUrl: true });
    browser.win.location.assign(bridge.decorateUrl("/panel"));

    // بارگذاری سند (مثل فشار دادن F5)
    const first = await browser.loadDocument(browser.currentUrl());
    expect(first.status).toBe(200);

    // ناوبری SPA که آدرس را با ?t به‌روز می‌کند
    browser.win.history.pushState({}, "", "/panel/cases");
    expect(browser.currentUrl()).toContain("t=");

    // F5 دوباره روی آدرس جدید
    const second = await browser.loadDocument(browser.currentUrl());
    expect(second.bounced).toBe(false);
    expect(second.status).toBe(200);
  });
});
