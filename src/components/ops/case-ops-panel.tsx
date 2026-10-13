"use client";

/**
 * پنل عملیات پرونده (داخل ویزارد خدمات): باکس اقدام سریع + گفت‌وگوی داخلی +
 * تاریخچه یکپارچه که پیام، ارجاع رسمی و رویداد سیستمی را از هم جدا نشان می‌دهد.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { opsFetch } from "./api";
import { QuickActions, type UnitOption } from "./quick-actions";
import { Conversation, type ConversationViewData } from "./conversation";
import {
  KANBAN_STATUS_LABELS,
  KANBAN_STATUS_TONE,
  OPS_EVENT_TYPE_LABELS,
  PRIORITY_LABELS,
  REFERRAL_KIND_LABELS,
} from "@/lib/fa-labels";
import { relativeFa, toJalaliDateTime } from "@/lib/jalali";

export interface OpsHistoryItem {
  type: "referral" | "message" | "system";
  id: string;
  at: string;
  title: string;
  body: string | null;
  actorName: string | null;
  meta?: Record<string, unknown>;
}

interface OpsPayload {
  ops: {
    caseId: string;
    kanbanStatus: string;
    statusLabel: string;
    currentUnit: string | null;
    currentUnitName: string | null;
    assignedStaffId: string | null;
    assignedStaffName: string | null;
    hasOwner: boolean;
    priority: string;
    dueAt: string | null;
    overdue: boolean;
    canAct: boolean;
    allowedActions: string[];
    unreadMessages: number;
    referralPath: Array<{
      id: string;
      depth: number;
      kind: "colleague" | "unit";
      actorName: string | null;
      fromName: string | null;
      fromUnitName: string | null;
      toName: string | null;
      toUnitName: string | null;
      reason: string | null;
      description: string | null;
      expectedOutput: string | null;
      note: string | null;
      priority: string | null;
      dueAt: string | null;
      statusBefore: string | null;
      statusAfter: string | null;
      result: string | null;
      outcomeNote: string | null;
      at: string;
    }>;
  };
  conversation: ConversationViewData;
}

interface Props {
  caseId: string;
  csrf: string;
  units: UnitOption[];
  staff: Array<{ id: string; fullName: string; title: string | null; unitKey: string | null; unitName: string | null }>;
  events: Array<{ id: string; kind: string; title: string; body: string | null; actorName: string | null; at: string }>;
}

export function CaseOpsPanel({ caseId, csrf, units, staff, events }: Props) {
  const [payload, setPayload] = useState<OpsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await opsFetch<OpsPayload>(`/api/v1/ops/cases/${caseId}`);
    setLoading(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setError(null);
    setPayload(res.data);
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ops = payload?.ops;

  const history: OpsHistoryItem[] = [
    ...(ops?.referralPath ?? []).map((node) => ({
      type: "referral" as const,
      id: node.id,
      at: node.at,
      title: `ارجاع گام ${node.depth}: ${node.actorName ?? node.fromName ?? "ورودی"} → ${node.toName ?? node.toUnitName}`,
      body: node.reason ?? node.description ?? null,
      actorName: node.actorName,
      meta: {
        kind: node.kind,
        fromUnitName: node.fromUnitName,
        toUnitName: node.toUnitName,
        expectedOutput: node.expectedOutput,
        priority: node.priority,
        dueAt: node.dueAt,
        statusBefore: node.statusBefore,
        statusAfter: node.statusAfter,
        outcomeNote: node.outcomeNote,
        note: node.note,
      },
    })),
    ...(payload?.conversation.messages ?? []).map((message) => ({
      type: "message" as const,
      id: message.id,
      at: message.createdAt,
      title: `پیام داخلی از ${message.authorName}`,
      body: message.deleted ? "[پیام حذف شده]" : message.body,
      actorName: message.authorName,
    })),
    ...events.map((event) => ({
      type: "system" as const,
      id: event.id,
      at: event.at,
      title: event.title,
      body: event.body,
      actorName: event.actorName,
      meta: { kind: event.kind },
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <div className="card ops-panel" id="ops-quick-actions">
      <div className="card-title-row">
        <div>
          <h3 style={{ margin: 0 }}>عملیات، ارجاع و گفت‌وگوی داخلی</h3>
          <div className="small muted">
            وضعیت عملیات مستقل از وضعیت خدمت است و ارجاع‌ها با تاریخچه کامل ثبت می‌شوند.
          </div>
        </div>
        {ops ? (
          <span className="flex wrap" style={{ gap: 6 }}>
            <span className={`badge ${KANBAN_STATUS_TONE[ops.kanbanStatus] ?? "muted"}`}>
              {KANBAN_STATUS_LABELS[ops.kanbanStatus] ?? ops.kanbanStatus}
            </span>
            <span className="badge muted">واحد: {ops.currentUnitName ?? "—"}</span>
            <span className="badge muted">مسئول: {ops.assignedStaffName ?? "بدون مسئول مشخص"}</span>
            {ops.overdue ? <span className="badge danger">عقب‌افتاده</span> : null}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="alert error">
          {error}
          <div className="small">
            <button type="button" className="secondary small" onClick={() => void load()}>
              تلاش دوباره
            </button>
          </div>
        </div>
      ) : null}
      {notice ? <div className="alert success">{notice}</div> : null}
      {loading && !payload ? <div className="small muted">در حال بارگذاری عملیات پرونده…</div> : null}

      {ops ? (
        <QuickActions
          caseId={caseId}
          csrf={csrf}
          units={units}
          ops={ops}
          onChanged={(message) => {
            setNotice(message);
            void load();
          }}
        />
      ) : null}

      <div className="grid grid-2" style={{ marginTop: 14 }}>
        <div id="conversation">
          <Conversation caseId={caseId} csrf={csrf} staff={staff} initial={payload?.conversation ?? null} />
        </div>

        <div>
          <div className="conversation-head">
            <span className="conversation-title">تاریخچه کامل عملیات</span>
            <span className="small muted">پیام، ارجاع رسمی و رویداد سیستمی جدا نمایش داده می‌شوند</span>
          </div>
          <div className="ops-history">
            {history.length === 0 ? <div className="empty">تاریخچه‌ای ثبت نشده است.</div> : null}
            {history.map((item) => (
              <div key={`${item.type}-${item.id}`} className={`history-item type-${item.type}`}>
                <div className="history-head">
                  <span className={`badge ${item.type === "referral" ? "info" : item.type === "message" ? "muted" : "warning"}`}>
                    {OPS_EVENT_TYPE_LABELS[item.type]}
                  </span>
                  <b>{item.title}</b>
                  <span className="small muted">{relativeFa(item.at)}</span>
                </div>
                {item.body ? <div className="small">{item.body}</div> : null}
                {item.type === "referral" && item.meta ? (
                  <div className="small muted">
                    {item.meta.kind ? `نوع: ${REFERRAL_KIND_LABELS[String(item.meta.kind)] ?? String(item.meta.kind)}` : ""}
                    {item.meta.statusBefore || item.meta.statusAfter
                      ? ` · وضعیت: ${KANBAN_STATUS_LABELS[String(item.meta.statusBefore)] ?? "—"} → ${KANBAN_STATUS_LABELS[String(item.meta.statusAfter)] ?? "—"}`
                      : ""}
                    {item.meta.priority ? ` · اولویت: ${PRIORITY_LABELS[String(item.meta.priority)] ?? String(item.meta.priority)}` : ""}
                    {item.meta.dueAt ? ` · مهلت: ${toJalaliDateTime(String(item.meta.dueAt))}` : ""}
                    {item.meta.expectedOutput ? ` · خروجی: ${String(item.meta.expectedOutput)}` : ""}
                    {item.meta.outcomeNote ? ` · نتیجه/علت برگشت: ${String(item.meta.outcomeNote)}` : ""}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            مشاهده همین عملیات روی تخته: <Link href="/panel/kanban">کانبان عملیات</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
