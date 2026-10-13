"use client";

/**
 * پل نشست سمت React:
 *  - وصله‌کردن fetch/تاریخ مرورگر با توکن نشست (بدون نیاز به کوکی یا سرویس‌ورکر)
 *  - اگر کاربر با توکن معتبر به صفحه ورود برگشت، خودکار به پنل برمی‌گردد
 *  - اگر کوکی نشست واقعاً کار می‌کند، توکن از آدرس پاک می‌شود (آدرس تمیز) ولی در
 *    حافظه می‌ماند تا در صورت پاک‌شدن کوکی، نشست خودکار بازیابی شود
 *  - دکمه خروج که هم نشست سرور و هم توکن مرورگر را پاک می‌کند
 */
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  createSessionBridge,
  createWindowScope,
  TICKET_QUERY,
  type SessionBridge,
  type WindowLike,
} from "./session-bridge-core";

let bridge: SessionBridge | null = null;

/** پنجرهٔ واقعی مرورگر به‌صورت زنده (وصله‌کردن روی window اثر می‌گذارد) */
function browserScope() {
  if (typeof window === "undefined") return null;
  return createWindowScope(window as unknown as WindowLike);
}

/** پل نشست مشترک در کل تب (تنبل ساخته می‌شود) */
export function getSessionBridge(): SessionBridge | null {
  if (bridge) return bridge;
  const scope = browserScope();
  if (!scope) return null;
  bridge = createSessionBridge(scope);
  return bridge;
}

/** خواندن توکن از نوار آدرس */
function ticketInAddressBar(): string | null {
  try {
    const value = new URLSearchParams(window.location.search).get(TICKET_QUERY);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
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

/** پاک‌کردن پارامتر توکن از نوار آدرس (بدون افزودن دوباره) */
function stripTicketFromAddressBar(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(TICKET_QUERY)) return;
    url.searchParams.delete(TICKET_QUERY);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  } catch {
    /* نادیده */
  }
}

export function SessionBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const running = useRef(false);

  useEffect(() => {
    const active = getSessionBridge();
    if (!active || running.current) return;

    const ticket = ticketInAddressBar() ?? active.ticketFromStorage();
    if (!ticket) return;

    running.current = true;
    // پیش‌فرض محافظه‌کارانه: توکن هم در آدرس بماند تا رفرش/بارگذاری مستقیم نشست را از دست ندهد
    active.activate(ticket, { keepInUrl: true });

    const onGuestPage = pathname === "/login" || pathname === "/";

    (async () => {
      const probe = async (withTicket: boolean): Promise<boolean> => {
        try {
          const response = await active.fetchWithoutTicket("/api/auth/session", {
            headers: withTicket ? { "x-session-ticket": ticket } : undefined,
            credentials: "include",
            cache: "no-store",
          });
          return response.ok;
        } catch {
          return false;
        }
      };

      const [ticketValid, cookiesOk] = await Promise.all([probe(true), probe(false)]);

      if (onGuestPage) {
        if (ticketValid) {
          // ناوبری کامل (نه SPA) تا توکن در درخواست سند هم حضور داشته باشد
          running.current = false;
          window.location.assign(active.decorateUrl("/panel"));
          return;
        }
        // توکن باطل/منقضی: پاک‌سازی تا کاربر با فرم ورود ادامه دهد
        active.deactivate();
        stripTicketFromAddressBar();
        router.refresh();
        return;
      }

      // داخل پنل: اگر کوکی نشست کار می‌کند، آدرس را تمیز می‌کنیم
      // (توکن در حافظه و ذخیره‌سازی می‌ماند؛ پس اگر کوکی بعداً از بین برود،
      //  کاربر در صفحه ورود خودکار به پنل برمی‌گردد)
      if (cookiesOk) {
        active.activate(ticket, { keepInUrl: false });
        stripTicketFromAddressBar();
      } else if (!ticketValid) {
        active.deactivate();
        stripTicketFromAddressBar();
        window.location.assign("/login");
      }
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
