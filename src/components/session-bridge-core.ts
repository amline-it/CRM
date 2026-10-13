/**
 * پل نشست مرورگر — جایگزین کوکی در محیط‌هایی که کوکی/ذخیره‌سازی مسدود است.
 *
 * چرا؟ در پنل داخل iframe یا مرورگرهایی با مسدودسازی کوکی شخص‌ثالث، کوکی نشست
 * ذخیره/ارسال نمی‌شود و کاربر با هر اقدام به صفحه ورود پرت می‌شود.
 *
 * راه‌حل: توکن نشست در حافظه صفحه نگه داشته می‌شود و با سه لایه محافظت می‌شود:
 *   ۱) وصله‌کردن fetch → همه درخواست‌های هم‌دامنه (ناوبری RSC، اکشن‌های سرور، API)
 *      هدر X-Session-Ticket می‌گیرند. (بدون نیاز به کوکی، سرویس‌ورکر یا ذخیره‌سازی)
 *   ۲) نگه‌داشتن توکن در آدرس (?t=…) → بارگذاری مستقیم/رفرش صفحه هم نشست را می‌شناسد
 *      و پروکسی سمت سرور آن را به هدر تبدیل می‌کند.
 *   ۳) localStorage (در صورت دسترس‌بودن) برای بازیابی بین تب‌ها/بارگذاری‌ها.
 *
 * ماژول عمداً بدون وابستگی به React/Next نوشته شده تا در آزمون‌ها با مرورگر جعلی
 * به‌طور کامل تست شود.
 */

export const TICKET_HEADER = "x-session-ticket";
export const TICKET_QUERY = "t";
export const TICKET_STORAGE_KEY = "crm_session_ticket";

export interface BridgeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BridgeScope {
  fetch: typeof globalThis.fetch;
  location: { href: string; origin?: string; assign(url: string): void; replace(url: string): void };
  history: {
    pushState(data: unknown, title: string, url?: string | URL | null): void;
    replaceState(data: unknown, title: string, url?: string | URL | null): void;
  };
  /** ممکن است وجود نداشته باشد یا پرتاب خطا کند (iframe با origin نامعتبر) */
  storage?: BridgeStorage | null;
  /**
   * شیئی که تابع اصلی fetch باید با آن فراخوانی شود (در مرورگر: window).
   * در مرورگرها `fetch` بدون this معتبر پرتاب خطا می‌کند، پس لازم است.
   */
  fetchHost?: unknown;
}

/** حداقل چیزی که از window لازم داریم (تا در آزمون‌ها با پنجره جعلی قابل استفاده باشد) */
export interface WindowLike {
  fetch: typeof globalThis.fetch;
  location: { href: string; origin?: string; assign(url: string): void; replace(url: string): void };
  history: BridgeScope["history"];
  localStorage?: BridgeStorage | null;
}

/**
 * ساخت BridgeScope از یک پنجره واقعی (window).
 *
 * نکته حیاتی: خواص fetch و history «زنده» هستند — نوشتن روی scope.fetch دقیقاً
 * window.fetch را عوض می‌کند. اگر به‌جای این، یک نسخهٔ bindشده در یک شیء محلی
 * گذاشته شود، وصله‌کردن بی‌اثر می‌شود و درخواست‌های روتر Next (که مستقیماً
 * fetch سراسری را صدا می‌زند) بدون هدر توکن می‌روند و کاربر به صفحه ورود برمی‌گردد.
 */
export function createWindowScope(win: WindowLike): BridgeScope {
  let storage: BridgeStorage | null = null;
  try {
    const candidate = win.localStorage ?? null;
    if (candidate) {
      // آزمایش دسترسی: در iframe با origin نامعتبر، دسترسی پرتاب خطا می‌کند
      candidate.getItem(TICKET_STORAGE_KEY);
      storage = candidate;
    }
  } catch {
    storage = null;
  }

  return {
    get fetch() {
      return win.fetch;
    },
    set fetch(value: typeof globalThis.fetch) {
      win.fetch = value;
    },
    get history() {
      return win.history;
    },
    set history(value: BridgeScope["history"]) {
      win.history = value;
    },
    fetchHost: win,
    location: win.location,
    storage,
  };
}

export interface ActivateOptions {
  /** نگه‌داشتن توکن در آدرس صفحه (برای رفرش و بارگذاری مستقیم) */
  keepInUrl?: boolean;
}

export interface SessionBridge {
  /** فعال‌سازی مسیر بدون کوکی با توکن داده‌شده */
  activate(ticket: string, options?: ActivateOptions): void;
  /** خاموش‌کردن وصله‌ها و پاک‌کردن توکن (خروج) */
  deactivate(): void;
  /** توکن فعلی (در حافظه، آدرس یا ذخیره‌سازی) */
  currentTicket(): string | null;
  /** آیا حالت بدون کوکی فعال است؟ */
  isActive(): boolean;
  /** درخواست بدون هدر توکن — برای بررسی اینکه کوکی کار می‌کند یا نه */
  fetchWithoutTicket(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** افزودن توکن به یک آدرس هم‌دامنه */
  decorateUrl(url: string): string;
  /** خواندن توکن از localStorage (بی‌صدا در صورت خطا) */
  ticketFromStorage(): string | null;
}

function safeOrigin(scope: BridgeScope): string {
  try {
    return scope.location.origin ?? new URL(scope.location.href).origin;
  } catch {
    return "";
  }
}

function parseUrl(value: string, base: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

/** ساخت آدرس با پارامتر توکن (فقط هم‌دامنه و نه فایل‌های استاتیک) */
export function decorateUrlWithTicket(scope: BridgeScope, url: string, ticket: string): string {
  const base = scope.location.href;
  const parsed = parseUrl(url, base);
  if (!parsed) return url;
  if (parsed.origin !== safeOrigin(scope)) return url;
  if (parsed.pathname.startsWith("/_next/")) return url;
  parsed.searchParams.set(TICKET_QUERY, ticket);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function ticketFromUrl(scope: BridgeScope): string | null {
  const parsed = parseUrl(scope.location.href, scope.location.href);
  const value = parsed?.searchParams.get(TICKET_QUERY);
  return value && value.trim() ? value.trim() : null;
}

export function createSessionBridge(scope: BridgeScope): SessionBridge {
  let ticket: string | null = null;
  let keepInUrl = false;
  let installed = false;

  const originalFetch = scope.fetch;
  // فراخوانی با this درست (window در مرورگر) تا خطای Illegal invocation رخ ندهد
  const callFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    originalFetch.call(scope.fetchHost ?? scope, input, init);
  const originalPushState = scope.history.pushState;
  const originalReplaceState = scope.history.replaceState;

  function readStorage(): string | null {
    try {
      const value = scope.storage?.getItem(TICKET_STORAGE_KEY);
      return value && value.trim() ? value.trim() : null;
    } catch {
      return null;
    }
  }

  function writeStorage(value: string | null): void {
    try {
      if (value) scope.storage?.setItem(TICKET_STORAGE_KEY, value);
      else scope.storage?.removeItem(TICKET_STORAGE_KEY);
    } catch {
      /* ذخیره‌سازی مسدود است؛ نادیده گرفته می‌شود */
    }
  }

  function decorate(url: string): string {
    if (!ticket || !keepInUrl) return url;
    return decorateUrlWithTicket(scope, url, ticket);
  }

  function patchFetch(): void {
    scope.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const activeTicket = ticket;
      if (!activeTicket) return callFetch(input, init);
      try {
        const rawUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
        const resolved = parseUrl(rawUrl, scope.location.href);
        if (!resolved || resolved.origin !== safeOrigin(scope)) return callFetch(input, init);

        const baseHeaders =
          init?.headers ?? (typeof input === "object" && input !== null && "headers" in input ? (input as Request).headers : undefined);
        const headers = new Headers(baseHeaders as HeadersInit | undefined);
        headers.set(TICKET_HEADER, activeTicket);
        if (typeof input === "string" || input instanceof URL) {
          return callFetch(input as RequestInfo, { ...init, headers });
        }
        return callFetch(new Request(input as Request, { headers }), init);
      } catch {
        return callFetch(input, init);
      }
    }) as typeof globalThis.fetch;
  }

  function patchHistory(): void {
    scope.history.pushState = (data: unknown, title: string, url?: string | URL | null) => {
      const next = url === undefined || url === null ? url : decorate(String(url));
      return originalPushState.call(scope.history, data, title, next);
    };
    scope.history.replaceState = (data: unknown, title: string, url?: string | URL | null) => {
      const next = url === undefined || url === null ? url : decorate(String(url));
      return originalReplaceState.call(scope.history, data, title, next);
    };
  }

  return {
    activate(nextTicket: string, options: ActivateOptions = {}) {
      ticket = nextTicket;
      keepInUrl = options.keepInUrl ?? false;
      writeStorage(nextTicket);
      if (!installed) {
        installed = true;
        patchFetch();
        patchHistory();
      }
      if (keepInUrl && ticketFromUrl(scope) !== nextTicket) {
        try {
          const state = (scope.history as { state?: unknown }).state;
          originalReplaceState.call(scope.history, state ?? null, "", decorate(scope.location.href));
        } catch {
          /* نادیده */
        }
      }
    },

    deactivate() {
      ticket = null;
      keepInUrl = false;
      writeStorage(null);
      if (installed) {
        installed = false;
        scope.fetch = originalFetch;
        scope.history.pushState = originalPushState;
        scope.history.replaceState = originalReplaceState;
      }
    },

    currentTicket() {
      return ticket ?? ticketFromUrl(scope) ?? readStorage();
    },

    isActive() {
      return Boolean(ticket) && installed;
    },

    fetchWithoutTicket(input: RequestInfo | URL, init?: RequestInit) {
      return callFetch(input, init);
    },

    decorateUrl(url: string) {
      return decorate(url);
    },

    ticketFromStorage: readStorage,
  };
}
