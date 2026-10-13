"use client";

/**
 * پل نشست سمت React:
 *  - وصله‌کردن fetch/تاریخ مرورگر با توکن نشست (بدون نیاز به کوکی یا سرویس‌ورکر)
 *  - اگر کاربر با توکن معتبر به صفحه ورود برگشت، خودکار به پنل برمی‌گردد
 *  - دکمه خروج که هم نشست سرور و هم توکن مرورگر را پاک می‌کند
 */
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  createSessionBridge,
  ticketFromUrl,
  TICKET_STORAGE_KEY,
  type SessionBridge,
  type BridgeScope,
} from "./session-bridge-core";

let bridge: SessionBridge | null = null;

function browserScope(): BridgeScope | null {
  if (typeof window === "undefined") return null;
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
    // آزمایش دسترسی: در iframe با origin نامعتبر، دسترسی پرتاب خطا می‌کند
    storage.getItem(TICKET_STORAGE_KEY);
  } catch {
    storage = null;
  }
  return {
    fetch: window.fetch.bind(window),
    location: {
      href: window.location.href,
      origin: window.location.origin,
      assign: (url: string) => window.location.assign(url),
      replace: (url: string) => window.location.replace(url),
    },
    history: window.history,
    storage,
  };
}

/** پل نشست مشترک در کل تب (تنبل ساخته می‌شود) */
export function getSessionBridge(): SessionBridge | null {
  if (bridge) return bridge;
  const scope = browserScope();
  if (!scope) return null;
  bridge = createSessionBridge(scope);
  return bridge;
}

/** خواندن توکن: آدرس → حافظه → ذخیره‌سازی */
export function readSessionTicket(): string | null {
  return getSessionBridge()?.currentTicket() ?? null;
}

/** نگه‌داشتن توکن نشست در مرورگر (برای مسیر بدون کوکی) */
export function saveSessionTicket(ticket: string, keepInUrl = true): void {
  getSessionBridge()?.activate(ticket, { keepInUrl });
}

export function clearSessionTicket(): void {
  getSessionBridge()?.deactivate();
}

/**
 * بررسی اینکه کوکی نشست واقعاً کار می‌کند یا نه (بدون هدر توکن).
 * اگر پاسخ ۲۰۰ باشد یعنی مرورگر کوکی را می‌فرستد و نیازی به مسیر جایگزین نیست.
 */
export async function cookiesWork(): Promise<boolean> {
  const active = getSessionBridge();
  try {
    const request = (url: string, init?: RequestInit) =>
      active ? active.fetchWithoutTicket(url, init) : fetch(url, init);
    const response = await request("/api/auth/session", { credentials: "include", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

export function SessionBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const running = useRef(false);

  useEffect(() => {
    const active = getSessionBridge();
    if (!active || running.current) return;

    const fromUrl = ticketFromUrl({ ...(browserScope() as BridgeScope) });
    const ticket = fromUrl ?? active.ticketFromStorage();
    if (!ticket) return;

    running.current = true;
    // توکن موجود = حالت بدون کوکی فعال شود (fetch و آدرس هر دو)
    active.activate(ticket, { keepInUrl: true });

    const onGuestPage = pathname === "/login" || pathname === "/";
    if (!onGuestPage) {
      running.current = false;
      return;
    }

    (async () => {
      let valid = false;
      try {
        const response = await active.fetchWithoutTicket("/api/auth/session", {
          headers: { "x-session-ticket": ticket },
          cache: "no-store",
        });
        valid = response.ok;
      } catch {
        valid = false;
      }

      if (valid) {
        // ناوبری کامل (نه SPA) تا توکن در درخواست سند هم حضور داشته باشد
        const target = active.decorateUrl("/panel");
        window.location.assign(target);
        return;
      }
      // توکن باطل/منقضی: پاک‌سازی تا کاربر با فرم ورود ادامه دهد
      active.deactivate();
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("t");
        window.history.replaceState(window.history.state, "", url.pathname + url.search);
      } catch {
        /* نادیده */
      }
      router.refresh();
    })().finally(() => {
      running.current = false;
    });
  }, [pathname, router]);

  return null;
}

/** دکمه خروج: باطل‌کردن نشست در سرور + پاک‌کردن توکن مرورگر */
export function LogoutButton({ label = "خروج", className = "btn secondary small" }: { label?: string; className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const active = getSessionBridge();
        try {
          if (active) await active.fetchWithoutTicket("/api/auth/session", { method: "DELETE" });
          else await fetch("/api/auth/session", { method: "DELETE" });
        } catch {
          /* نادیده */
        }
        active?.deactivate();
        window.location.assign("/login");
      }}
    >
      {label}
    </button>
  );
}
