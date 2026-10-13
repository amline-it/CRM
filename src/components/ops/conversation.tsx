"use client";

/**
 * گفت‌وگوی داخلی پرونده — پیام، منشن همکار (@) و ویرایش/حذف پیام نویسنده.
 *
 * نکته امنیتی: این پیام‌ها داخلی‌اند و از APIهای سینک/مشتری جدا هستند؛ همین
 * کامپوننت فقط از مسیر `/api/v1/ops/*` با نشست کارمند داده می‌گیرد.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { opsFetch, newIdempotencyKey } from "./api";
import { relativeFa } from "@/lib/jalali";

export interface MentionTargetView {
  staffId: string;
  fullName: string;
  unitKey: string | null;
  unitName: string | null;
}

export interface MessageView {
  id: string;
  caseId: string;
  authorStaffId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  isMine: boolean;
  mentions: MentionTargetView[];
}

export interface ConversationViewData {
  caseId: string;
  messages: MessageView[];
  unread: number;
  mentionedMe: string[];
  participants: MentionTargetView[];
  canPost: boolean;
}

interface StaffOption {
  id: string;
  fullName: string;
  title: string | null;
  unitKey: string | null;
  unitName: string | null;
}

interface Props {
  caseId: string;
  csrf: string;
  initial?: ConversationViewData | null;
  staff: StaffOption[];
  compact?: boolean;
  onUnreadChange?: (unread: number) => void;
}

export function Conversation({ caseId, csrf, initial, staff, compact = false, onUnreadChange }: Props) {
  const [data, setData] = useState<ConversationViewData | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await opsFetch<ConversationViewData>(`/api/v1/ops/cases/${caseId}/messages`, { method: "GET" });
    setLoading(false);
    if (result.ok) {
      setData(result.data);
      onUnreadChange?.(0);
      setError(null);
    } else {
      setError(result.message);
    }
  }, [caseId, onUnreadChange]);

  useEffect(() => {
    if (!initial) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [data?.messages.length]);

  const suggestion = useMemo(() => {
    const match = draft.match(/@([^\s@]*)$/);
    if (!match) return null;
    const query = match[1].trim();
    if (!query) return null;
    const found = staff.filter((s) => s.fullName.includes(query)).slice(0, 6);
    return found.length ? { query, found } : null;
  }, [draft, staff]);

  function insertMention(option: StaffOption) {
    setDraft((current) => current.replace(/@([^\s@]*)$/, `@${option.fullName} `));
    setMentions((current) => (current.includes(option.id) ? current : [...current, option.id]));
    boxRef.current?.focus();
  }

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await opsFetch<{ message: MessageView; notified: number }>(`/api/v1/ops/cases/${caseId}/messages`, {
      method: "POST",
      csrf,
      idempotencyKey: newIdempotencyKey(),
      body: { body, mentionStaffIds: mentions },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDraft("");
    setMentions([]);
    setNotice(result.data.notified ? `${result.data.notified} اعلان برای همکاران ارسال شد` : "پیام ثبت شد");
    await load();
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    const result = await opsFetch(`/api/v1/ops/messages/${editing.id}`, {
      method: "PATCH",
      csrf,
      body: { body: editing.body },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEditing(null);
    setNotice("پیام ویرایش شد (نسخه قبلی در حسابرسی ثبت است)");
    await load();
  }

  async function remove(messageId: string) {
    setBusy(true);
    const result = await opsFetch(`/api/v1/ops/messages/${messageId}`, { method: "DELETE", csrf });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice("پیام حذف شد (حذف نرم، برای حسابرسی باقی می‌ماند)");
    await load();
  }

  const messages = data?.messages ?? [];

  return (
    <div className={`conversation${compact ? " compact" : ""}`}>
      <div className="conversation-head">
        <span className="conversation-title">
          گفت‌وگوی داخلی پرونده
          {data?.unread ? <span className="badge warning">{data.unread} پیام جدید</span> : null}
        </span>
        <button type="button" className="secondary small" onClick={() => void load()} disabled={loading}>
          {loading ? "…" : "به‌روزرسانی"}
        </button>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      <div className="conversation-list" ref={listRef}>
        {!messages.length && !loading ? (
          <div className="empty">هنوز پیامی در این پرونده ثبت نشده است؛ اولین پیام داخلی را بفرستید.</div>
        ) : null}
        {messages.map((message) => {
          const mentionedMe = (data?.mentionedMe ?? []).includes(message.id);
          return (
            <div key={message.id} className={`msg${message.isMine ? " mine" : ""}${mentionedMe ? " mentioned" : ""}`}>
              <div className="msg-head">
                <b>{message.authorName}</b>
                <span className="small muted">{relativeFa(message.createdAt)}</span>
                {message.editedAt ? <span className="badge muted">ویرایش‌شده</span> : null}
                {mentionedMe ? <span className="badge info">منشن شما</span> : null}
              </div>
              {editing?.id === message.id ? (
                <div className="msg-edit">
                  <textarea
                    value={editing.body}
                    onChange={(e) => setEditing({ id: message.id, body: e.target.value })}
                    rows={2}
                  />
                  <div className="msg-actions">
                    <button type="button" className="small" onClick={() => void saveEdit()} disabled={busy}>
                      ذخیره
                    </button>
                    <button type="button" className="secondary small" onClick={() => setEditing(null)}>
                      انصراف
                    </button>
                  </div>
                </div>
              ) : (
                <div className="msg-body">
                  {message.deleted ? <span className="muted">[پیام حذف شده است]</span> : renderBody(message.body, message.mentions)}
                </div>
              )}
              <div className="msg-foot">
                {message.mentions.length ? (
                  <span className="small muted">
                    منشن: {message.mentions.map((m) => m.fullName).join("، ")}
                  </span>
                ) : null}
                {message.isMine && !message.deleted && editing?.id !== message.id ? (
                  <span className="msg-actions">
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => setEditing({ id: message.id, body: message.body })}
                    >
                      ویرایش
                    </button>
                    <button type="button" className="secondary small" onClick={() => void remove(message.id)} disabled={busy}>
                      حذف
                    </button>
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {data && !data.canPost ? (
        <div className="alert warning">این پرونده بسته شده است و گفت‌وگوی تازه نمی‌پذیرد.</div>
      ) : (
        <div className="conversation-composer">
          <textarea
            ref={boxRef}
            rows={compact ? 2 : 3}
            value={draft}
            placeholder="پیام داخلی… برای خطاب‌کردن همکار از @ استفاده کنید (مثلاً @سارا احمدی)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
            }}
          />
          {suggestion ? (
            <div className="mention-suggest">
              {suggestion.found.map((option) => (
                <button key={option.id} type="button" className="mention-item" onClick={() => insertMention(option)}>
                  <b>{option.fullName}</b>
                  {option.unitName ? <span className="small muted"> — {option.unitName}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          {mentions.length ? (
            <div className="small muted">
              منشن‌شده: {mentions.map((id) => staff.find((s) => s.id === id)?.fullName ?? id).join("، ")}
            </div>
          ) : null}
          <div className="conversation-actions">
            <span className="small muted">Ctrl+Enter برای ارسال · منشن فقط اعلان می‌سازد و مسئولیت را منتقل نمی‌کند</span>
            <button type="button" className="small" onClick={() => void send()} disabled={busy || !draft.trim()}>
              {busy ? "…" : "ارسال پیام"}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

/** متن پیام با برجسته‌سازی نام‌های منشن‌شده */
function renderBody(body: string, mentions: MentionTargetView[]) {
  if (!mentions.length) return body;
  const names = mentions.map((m) => m.fullName).sort((a, b) => b.length - a.length);
  const parts: Array<string | { mention: string }> = [body];
  for (const name of names) {
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (typeof part !== "string") continue;
      const token = `@${name}`;
      if (!part.includes(token)) continue;
      const chunks = part.split(token);
      const rebuilt: Array<string | { mention: string }> = [];
      chunks.forEach((chunk, index) => {
        if (chunk) rebuilt.push(chunk);
        if (index < chunks.length - 1) rebuilt.push({ mention: name });
      });
      parts.splice(i, 1, ...rebuilt);
      i += rebuilt.length - 1;
    }
  }
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <span key={index}>{part}</span>
        ) : (
          <span key={index} className="mention-tag">
            @{part.mention}
          </span>
        ),
      )}
    </>
  );
}
