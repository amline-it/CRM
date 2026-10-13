"use client";

/**
 * شمارنده اعلان‌های خوانده‌نشده در نوار بالای پنل.
 * شمار اولیه از سرور می‌آید (رندر سرور) و سپس با واکشی دوره‌ای سبک تازه می‌شود؛
 * بنابر تصمیم فنی، WebSocket/سرویس بلادرنگ اضافه نشده است.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { faDigits } from "@/lib/jalali";

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    async function tick() {
      try {
        const response = await fetch("/api/v1/ops/notifications/count", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          if (active) setFailed(true);
          return;
        }
        const payload = (await response.json()) as { ok?: boolean; data?: { unread?: number } };
        if (active && payload.ok) {
          setUnread(payload.data?.unread ?? 0);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      }
    }
    const timer = setInterval(() => void tick(), 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <Link href="/panel/inbox" className="bell" title={failed ? "واکشی شمارنده اعلان ناموفق بود؛ صفحه را تازه کنید" : "صندوق اعلان داخلی"}>
      <span>اعلان‌ها</span>
      {unread > 0 ? <span className="badge warning">{faDigits(unread)}</span> : <span className="badge muted">۰</span>}
    </Link>
  );
}
