"use client";

/**
 * صندوق اعلان داخلی — خوانده/نخوانده، علامت‌گذاری، فیلتر و لینک مستقیم به پرونده.
 * برای تازگی اعلان‌ها واکشی دوره‌ای سبک (polling) استفاده می‌شود؛ زیرساخت بلادرنگ
 * جدیدی اضافه نشده است.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { opsFetch } from "./api";
import { INBOX_FILTERS, INBOX_KIND_LABELS, INBOX_KIND_TONE } from "@/lib/fa-labels";
import { relativeFa } from "@/lib/jalali";

interface InboxItem {
  id: string;
  kind: string | null;
  body: string;
  link: string | null;
  case_id: string | null;
  read_at: string | null;
  created_at: string;
  template: string;
}

interface InboxPayload {
  items: InboxItem[];
  unread: number;
  unreadByKind: { mention: number; referral: number; due: number };
}

interface Props {
  csrf: string;
  initial: InboxPayload;
  filter: string;
  unreadOnly: boolean;
}

export function InboxList({ csrf, initial, filter, unreadOnly }: Props) {
  const [items, setItems] = useState<InboxItem[]>(initial.items);
  const [unread, setUnread] = useState(initial.unread);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (unreadOnly) params.set("filter", "unread");
    params.set("limit", "50");
    const res = await opsFetch<InboxPayload>(`/api/v1/ops/notifications?${params.toString()}`);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setError(null);
    setItems(res.data.items);
    setUnread(res.data.unread);
  }, [unreadOnly]);

  // واکشی دوره‌ای سبک (۳۰ ثانیه) — بدون WebSocket
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [live, load]);

  const kinds = INBOX_FILTERS.find((f) => f.key === filter)?.kinds ?? [];
  const visible = kinds.length ? items.filter((item) => kinds.includes(item.kind ?? "")) : items;

  async function markRead(id: string) {
    setBusy(true);
    const res = await opsFetch<{ marked: number; unread: number }>("/api/v1/ops/notifications", {
      method: "POST",
      csrf,
      body: { ids: [id] },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setItems((current) => current.map((item) => (item.id === id ? { ...item, read_at: new Date().toISOString() } : item)));
    setUnread(res.data.unread);
  }

  async function markAll() {
    setBusy(true);
    const res = await opsFetch<{ marked: number; unread: number }>("/api/v1/ops/notifications", {
      method: "POST",
      csrf,
      body: { all: true },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })));
    setUnread(res.data.unread);
  }

  return (
    <div className="inbox">
      <div className="inbox-toolbar">
        <span className="badge warning">{unread} خوانده‌نشده</span>
        <span className="badge info">منشن: {initial.unreadByKind.mention}</span>
        <span className="badge muted">ارجاع/صف: {initial.unreadByKind.referral}</span>
        <span className="badge danger">سررسید: {initial.unreadByKind.due}</span>
        <span className="flex" style={{ gap: 6, marginInlineStart: "auto" }}>
          <button type="button" className="secondary small" onClick={() => void load()} disabled={busy}>
            به‌روزرسانی
          </button>
          <button type="button" className="secondary small" onClick={() => setLive((v) => !v)}>
            {live ? "توقف واکشی خودکار" : "واکشی خودکار"}
          </button>
          <button type="button" className="small" onClick={() => void markAll()} disabled={busy || unread === 0}>
            همه خوانده شد
          </button>
        </span>
      </div>

      {error ? <div className="alert error">{error}</div> : null}

      {visible.length === 0 ? (
        <div className="empty">اعلانی برای نمایش نیست. با ارجاع کار، منشن یا سررسید مهلت، اعلان تازه ساخته می‌شود.</div>
      ) : (
        <div className="inbox-list">
          {visible.map((item) => (
            <div key={item.id} className={`inbox-item${item.read_at ? "" : " unread"}`}>
              <div className="inbox-head">
                <span className={`badge ${INBOX_KIND_TONE[item.kind ?? ""] ?? "muted"}`}>
                  {INBOX_KIND_LABELS[item.kind ?? ""] ?? item.kind ?? "اعلان"}
                </span>
                <span className="small muted">{relativeFa(item.created_at)}</span>
                {!item.read_at ? <span className="badge warning">جدید</span> : null}
              </div>
              <div className="inbox-body">{item.body}</div>
              <div className="inbox-actions">
                {item.link ? (
                  <Link
                    href={item.link}
                    className="secondary small"
                    onClick={() => void markRead(item.id)}
                  >
                    مشاهده پرونده
                  </Link>
                ) : null}
                {!item.read_at ? (
                  <button type="button" className="secondary small" onClick={() => void markRead(item.id)} disabled={busy}>
                    خوانده شد
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
