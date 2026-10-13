"use client";

/**
 * پل نشست سمت مرورگر:
 *  ۱) توکن جلسه را (بعد از ورود) در localStorage نگه می‌دارد،
 *  ۲) آن را به سرویس‌ورکر می‌دهد تا روی درخواست‌ها هدر شود،
 *  ۳) اگر کوکی مسدود باشد و کاربر به صفحه ورود پرت شده باشد، با همان توکن برمی‌گرداند.
 *
 * این مسیر در سرور خودکار است: اگر کوکی کار کند هیچ تفاوتی حس نمی‌شود.
 */
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

const TICKET_KEY = "crm_session_ticket";

export function readSessionTicket(): string | null {
  try {
    return window.localStorage.getItem(TICKET_KEY);
  } catch {
    return null;
  }
}

export function saveSessionTicket(ticket: string): void {
  try {
    window.localStorage.setItem(TICKET_KEY, ticket);
  } catch {
    /* ذخیره‌سازی مسدود است */
  }
}

export function clearSessionTicket(): void {
  try {
    window.localStorage.removeItem(TICKET_KEY);
  } catch {
    /* نادیده */
  }
}

/** ثبت سرویس‌ورکر و دادن توکن به آن (تا روی همه درخواست‌ها هدر شود) */
export async function syncTicketToWorker(ticket: string | null): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.register("/session-worker.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const target = navigator.serviceWorker.controller ?? registration.active ?? registration.waiting;
    if (!target) return false;
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(), 3000);
      channel.port1.onmessage = () => {
        clearTimeout(timer);
        resolve();
      };
      target.postMessage({ type: "set-ticket", ticket: ticket ?? "" }, [channel.port2]);
    });
    // اطمینان از اینکه نسخه فعال ورکر، کوکی/هدر را روی درخواست بعدی می‌گذارد
    if (navigator.serviceWorker.controller !== target) {
      await new Promise<void>((resolve) => {
        const onControllerChange = () => {
          navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
          resolve();
        };
        navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
        setTimeout(resolve, 3000);
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * ورود بدون کوکی: بررسی می‌کند توکن ذخیره‌شده معتبر است یا نه.
 * اگر معتبر بود، کاربر را به پنل برمی‌گرداند (بدون حلقه بی‌پایان با صفحه ورود).
 */
export function SessionBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const running = useRef(false);

  useEffect(() => {
    const ticket = readSessionTicket();
    if (!ticket || running.current) return;
    const onLoginish = pathname === "/login" || pathname === "/";
    running.current = true;

    (async () => {
      const workerReady = await syncTicketToWorker(ticket);
      if (!onLoginish) return;
      let valid = false;
      try {
        const response = await fetch("/api/auth/session", {
          headers: { "x-session-ticket": ticket },
          cache: "no-store",
        });
        valid = response.ok;
      } catch {
        valid = false;
      }
      if (valid) {
        router.replace("/panel");
        router.refresh();
      } else {
        // توکن باطل/منقضی: پاک می‌شود تا کاربر با فرم ورود ادامه دهد
        clearSessionTicket();
        await syncTicketToWorker(null);
      }
    })().finally(() => {
      running.current = false;
    });
  }, [pathname, router]);

  return null;
}

/** دکمه خروج: ابتدا نشست در سرور باطل می‌شود، سپس توکن مرورگر پاک می‌شود */
export function LogoutButton({ label = "خروج", className = "btn secondary small" }: { label?: string; className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await fetch("/api/auth/session", { method: "DELETE" });
        } catch {
          /* نادیده */
        }
        clearSessionTicket();
        await syncTicketToWorker(null);
        router.replace("/login");
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
