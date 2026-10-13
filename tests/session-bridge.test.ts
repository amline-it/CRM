/**
 * آزمون پل نشست مرورگر — با «مرورگر جعلی» که کوکی ندارد و ذخیره‌سازی‌اش هم می‌تواند مسدود باشد.
 * این دقیقاً همان شرایطی است که کاربر در پنل داخل iframe تجربه می‌کند.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  createSessionBridge,
  decorateUrlWithTicket,
  ticketFromUrl,
  TICKET_STORAGE_KEY,
  type BridgeScope,
} from "@/components/session-bridge-core";

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function makeStorage(initial: Record<string, string> = {}, opts: { throwOnAccess?: boolean } = {}) {
  const data = new Map(Object.entries(initial));
  const guard = () => {
    if (opts.throwOnAccess) throw new Error("SecurityError: storage blocked");
  };
  return {
    data,
    getItem(key: string) {
      guard();
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      guard();
      data.set(key, value);
    },
    removeItem(key: string) {
      guard();
      data.delete(key);
    },
  };
}

function makeScope(options: { href?: string; storage?: BridgeScope["storage"]; assignLog?: string[] } = {}) {
  const href = options.href ?? "https://crm.example.com/panel";
  const calls: RecordedCall[] = [];
  const historyCalls: Array<{ kind: string; url: string | undefined }> = [];
  const assignLog = options.assignLog ?? [];

  const scope: BridgeScope = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      const headers: Record<string, string> = {};
      const source = init?.headers ?? (typeof input === "object" && input !== null && "headers" in input ? (input as Request).headers : undefined);
      if (source) new Headers(source as HeadersInit).forEach((value, key) => (headers[key] = value));
      calls.push({ url, method: init?.method ?? "GET", headers });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
    location: {
      href,
      origin: new URL(href).origin,
      assign: (url: string) => assignLog.push(`assign:${url}`),
      replace: (url: string) => assignLog.push(`replace:${url}`),
    },
    history: {
      pushState: (_data, _title, url) => historyCalls.push({ kind: "push", url: url ? String(url) : undefined }),
      replaceState: (_data, _title, url) => historyCalls.push({ kind: "replace", url: url ? String(url) : undefined }),
    },
    storage: options.storage ?? null,
  };
  return { scope, calls, historyCalls, assignLog };
}

const TICKET = "eyJhbGciOiJIUzI1NiJ9.payload.signature";

describe("پل نشست — وصله fetch", () => {
  it("هدر توکن روی درخواست‌های هم‌دامنه گذاشته می‌شود", async () => {
    const { scope, calls } = makeScope();
    const bridge = createSessionBridge(scope);
    bridge.activate(TICKET);

    await scope.fetch("/api/auth/session");
    await scope.fetch("https://crm.example.com/panel/cases");
    await scope.fetch(new URL("https://crm.example.com/panel"));

    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.headers["x-session-ticket"]).toBe(TICKET);
  });

  it("درخواست‌های بیرون از دامنه دست‌نخورده می‌مانند", async () => {
    const { scope, calls } = makeScope();
    const bridge = createSessionBridge(scope);
    bridge.activate(TICKET);
    await scope.fetch("https://cdn.example.org/lib.js");
    expect(calls[0].headers["x-session-ticket"]).toBeUndefined();
  });

  it("درخواست با شیء Request هم هدر می‌گیرد و شیء اصلی تغییر نمی‌کند", async () => {
    const { scope, calls } = makeScope();
    const bridge = createSessionBridge(scope);
    bridge.activate(TICKET);
    const original = new Request("https://crm.example.com/panel", { headers: { "x-custom": "1" } });
    await scope.fetch(original);
    expect(calls[0].headers["x-session-ticket"]).toBe(TICKET);
    expect(calls[0].headers["x-custom"]).toBe("1");
    expect(original.headers.get("x-session-ticket")).toBeNull();
  });

  it("درخواست بدون توکن (برای سنجش کوکی) هدر ندارد", async () => {
    const { scope, calls } = makeScope();
    const bridge = createSessionBridge(scope);
    bridge.activate(TICKET);
    await bridge.fetchWithoutTicket("/api/auth/session", { credentials: "include" });
    expect(calls[0].headers["x-session-ticket"]).toBeUndefined();
  });

  it("پس از خاموش‌کردن، fetch به حالت اولیه برمی‌گردد", async () => {
    const { scope, calls } = makeScope();
    const originalFetch = scope.fetch;
    const bridge = createSessionBridge(scope);
    bridge.activate(TICKET);
    expect(scope.fetch).not.toBe(originalFetch);
    bridge.deactivate();
    expect(scope.fetch).toBe(originalFetch);
    await scope.fetch("/panel");
    expect(calls[0].headers["x-session-ticket"]).toBeUndefined();
  });
});

describe("پل نشست — توکن در آدرس", () => {
  it("توکن به آدرس‌های هم‌دامنه اضافه می‌شود و به فایل‌های استاتیک نه", () => {
    const { scope } = makeScope({ href: "https://crm.example.com/panel?x=1" });
    expect(decorateUrlWithTicket(scope, "/panel/cases?status=open", TICKET)).toBe(
      `/panel/cases?status=open&t=${TICKET}`,
    );
    expect(decorateUrlWithTicket(scope, "/_next/static/chunk.js", TICKET)).toBe("/_next/static/chunk.js");
    expect(decorateUrlWithTicket(scope, "https://other.example.com/panel", TICKET)).toBe("https://other.example.com/panel");
  });

  it("با keepInUrl توکن در pushState/replaceState حفظ می‌شود", () => {
    const { scope, historyCalls } = makeScope();
    const bridge = createSessionBridge(scope);
    bridge.activate(TICKET, { keepInUrl: true });

    scope.history.pushState(null, "", "/panel/cases");
    scope.history.replaceState(null, "", "/panel/cases/1?tab=docs");

    const pushes = historyCalls.filter((call) => call.kind === "push");
    const replaces = historyCalls.filter((call) => call.kind === "replace");
    expect(pushes[0].url).toContain(`t=${TICKET}`);
    expect(replaces.at(-1)?.url).toContain("tab=docs");
    expect(replaces.at(-1)?.url).toContain(`t=${TICKET}`);
  });

  it("بدون keepInUrl آدرس‌ها دست‌نخورده می‌مانند (حالت عادی سرور کاربر)", () => {
    const { scope, historyCalls } = makeScope();
    const bridge = createSessionBridge(scope);
    bridge.activate(TICKET, { keepInUrl: false });
    scope.history.pushState(null, "", "/panel/cases");
    expect(historyCalls[0].url).toBe("/panel/cases");
    expect(bridge.decorateUrl("/panel/cases")).toBe("/panel/cases");
  });

  it("توکن از آدرس خوانده می‌شود", () => {
    const { scope } = makeScope({ href: `https://crm.example.com/login?t=${TICKET}` });
    expect(ticketFromUrl(scope)).toBe(TICKET);
    const clean = makeScope({ href: "https://crm.example.com/login" });
    expect(ticketFromUrl(clean.scope)).toBeNull();
  });
});

describe("پل نشست — ذخیره‌سازی و حالت‌های سخت", () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
  });

  it("توکن در localStorage ذخیره و بازیابی می‌شود", () => {
    const { scope } = makeScope({ storage });
    const bridge = createSessionBridge(scope);
    bridge.activate(TICKET, { keepInUrl: true });
    expect(storage.data.get(TICKET_STORAGE_KEY)).toBe(TICKET);

    // تب جدید: بدون توکن در حافظه، از ذخیره‌سازی خوانده می‌شود
    const second = createSessionBridge(scope);
    expect(second.currentTicket()).toBe(TICKET);
  });

  it("ذخیره‌سازی مسدود هم مانع کارکرد نمی‌شود", async () => {
    const blocked = makeStorage({}, { throwOnAccess: true });
    const { scope, calls } = makeScope({ storage: blocked });
    const bridge = createSessionBridge(scope);
    expect(() => bridge.activate(TICKET, { keepInUrl: true })).not.toThrow();
    expect(bridge.currentTicket()).toBe(TICKET); // از حافظه صفحه
    await scope.fetch("/panel");
    expect(calls[0].headers["x-session-ticket"]).toBe(TICKET);
  });

  it("خروج، توکن حافظه و ذخیره‌سازی را پاک می‌کند", () => {
    const { scope } = makeScope({ storage });
    const bridge = createSessionBridge(scope);
    bridge.activate(TICKET, { keepInUrl: true });
    bridge.deactivate();
    expect(bridge.currentTicket()).toBeNull();
    expect(bridge.isActive()).toBe(false);
    expect(storage.data.get(TICKET_STORAGE_KEY)).toBeUndefined();
  });

  it("وصله‌گذاری دوباره، fetch را چندبار پوشش نمی‌دهد", async () => {
    const { scope, calls } = makeScope();
    const bridge = createSessionBridge(scope);
    bridge.activate("token-one");
    bridge.activate("token-two");
    await scope.fetch("/panel");
    expect(calls).toHaveLength(1);
    expect(calls[0].headers["x-session-ticket"]).toBe("token-two");
  });
});
