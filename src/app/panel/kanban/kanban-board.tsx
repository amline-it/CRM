"use client";

/**
 * تخته کانبان عملیات — ستون = واحد سازمانی، کارت = عملیات واقعی پرونده،
 * وضعیت = فیلد مستقل هر کارت.
 *
 * دو جابه‌جایی روی تخته انجام می‌شود:
 *   ۱) **کارت** را بکشید روی ستون واحد مقصد → ارجاع رسمی (تغییر واحد/مسئول).
 *   ۲) **ستون** را از سرستون (دستهٔ ⠿) بکشید و روی ستون دیگری رها کنید → ترتیب
 *      ستون‌ها. تنها راه جابه‌جایی ستون همین درگ‌انددراپ است. ترتیب با
 *      `PUT /api/v1/ops/board/columns` روی سرور ذخیره می‌شود: به‌صورت پیش‌فرض
 *      چیدمان شخصی همین کارمند و با دکمه «ترتیب پیش‌فرض همه» برای مدیر، ترتیب
 *      مشترک تیم. تا پاسخ سرور، ترتیب قبلی معتبر است و در خطا برمی‌گردد.
 * تغییر وضعیت کارت هم فقط از API انجام می‌شود و در خطا وضعیت معتبر قبلی می‌ماند.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  KANBAN_STATUS_LABELS,
  KANBAN_STATUS_TONE,
  REFERRAL_KIND_LABELS,
  OPS_EVENT_TYPE_LABELS,
  PRIORITY_LABELS,
  SERVICE_KIND_LABELS,
} from "@/lib/fa-labels";
import { relativeFa, toJalaliDateTime } from "@/lib/jalali";
import { moveColumnKey } from "@/lib/board-order";
import { opsFetch, newIdempotencyKey } from "@/components/ops/api";
import { QuickActions, type OpsState, type UnitOption } from "@/components/ops/quick-actions";
import { Conversation, type ConversationViewData } from "@/components/ops/conversation";
import type { Board, BoardCard, BoardColumn } from "@/domain/service/referral-service";

interface StaffOption {
  id: string;
  fullName: string;
  title: string | null;
  unitKey: string | null;
  unitName: string | null;
}

interface Props {
  board: Board;
  csrf: string;
  units: UnitOption[];
  staff: StaffOption[];
}

function statusTone(status: string): string {
  return KANBAN_STATUS_TONE[status] ?? "muted";
}

type DragPayload = { type: "card" | "column"; id: string };

export function KanbanBoard({ board, csrf, units, staff }: Props) {
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragOverUnit, setDragOverUnit] = useState<string | null>(null);
  const [busyCardId, setBusyCardId] = useState<string | null>(null);
  const [result, setResult] = useState<{ error?: string; message?: string }>({});
  const [, startTransition] = useTransition();
  const router = useRouter();

  /* ── چیدمان ستون‌ها ─────────────────────────────────────────────── */
  const serverKeys = board.columns.map((column) => column.unitKey);
  const serverOrder = board.columnOrder.length ? board.columnOrder.filter((key) => serverKeys.includes(key)) : serverKeys;
  // امضای وضعیت سرور: با هر رفرش/فیلتر تازه، ترتیبِ تأییدشده سرور جایگزین حالت محلی می‌شود
  const serverSignature = `${serverOrder.join(">")}|${board.inbox.map((card) => card.caseId).join(">")}`;
  const [local, setLocal] = useState<{ signature: string; order: string[]; source: "personal" | "default" }>({
    signature: serverSignature,
    order: serverOrder,
    source: board.columnOrderSource,
  });
  const lastSavedRef = useRef<string[]>([...serverOrder]);
  const dragRef = useRef<DragPayload | null>(null);
  const [colDragKey, setColDragKey] = useState<string | null>(null);
  const [colDropKey, setColDropKey] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  if (local.signature !== serverSignature) {
    // پاسخ تازه سرور (رفرش تخته) → ترتیب تأییدشده جای حالت محلی را می‌گیرد
    setLocal({ signature: serverSignature, order: serverOrder, source: board.columnOrderSource });
    lastSavedRef.current = [...serverOrder];
  }

  // ترتیب مؤثر برای رندر: کلیدهای چیده‌شده + هر ستونی که در ترتیب نیست (مثلاً واحد تازه)
  const orderForRender = [
    ...local.order.filter((key) => serverKeys.includes(key)),
    ...serverKeys.filter((key) => !local.order.includes(key)),
  ];
  const orderedColumns = orderForRender
    .map((key) => board.columns.find((column) => column.unitKey === key))
    .filter((column): column is BoardColumn => Boolean(column));

  const allCards = [...board.columns.flatMap((c) => c.cards), ...board.inbox];
  const activeCard = activeCardId ? allCards.find((c) => c.caseId === activeCardId) ?? null : null;

  function refresh(message: string) {
    setResult({ message });
    startTransition(() => router.refresh());
  }

  /** ذخیره ترتیب ستون‌ها روی سرور؛ در خطا ترتیب تأییدشده قبلی برمی‌گردد */
  async function persistColumnOrder(nextOrder: string[], scope: "personal" | "default") {
    setSavingOrder(true);
    setResult({});
    const res = await opsFetch<{ order: string[]; source: string }>("/api/v1/ops/board/columns", {
      method: "PUT",
      csrf,
      body: { order: nextOrder, scope },
    });
    setSavingOrder(false);
    if (!res.ok) {
      const fallback = lastSavedRef.current;
      setLocal((prev) => ({ signature: prev.signature, order: fallback, source: prev.source }));
      setResult({ error: `${res.message} — ترتیب ستون‌ها تغییر نکرد` });
      return;
    }
    const confirmed = res.data.order.length ? res.data.order : nextOrder;
    lastSavedRef.current = [...confirmed];
    setLocal((prev) => ({
      signature: prev.signature,
      order: confirmed,
      source: res.data.source === "personal" ? "personal" : "default",
    }));
    setResult({
      message:
        scope === "default"
          ? "ترتیب ستون‌ها برای همه کارکنان ذخیره شد"
          : "چیدمان ستون‌های شما ذخیره شد",
    });
  }

  function reorderColumn(fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    const next = moveColumnKey(orderForRender, fromKey, toKey);
    if (next === orderForRender) return;
    setLocal((prev) => ({ ...prev, order: next }));
    void persistColumnOrder(next, "personal");
  }

  /**
   * رهاکردن روی ستون:
   *   - اگر ستون کشیده شده باشد → جابه‌جایی ترتیب ستون‌ها
   *   - اگر کارت کشیده شده باشد → ارجاع رسمی به واحد همان ستون
   */
  async function dropOnUnit(event: React.DragEvent<HTMLDivElement>, targetUnitKey: string) {
    event.preventDefault();
    setDragOverUnit(null);
    setColDropKey(null);
    const payload = dragRef.current;
    const columnKey = payload?.type === "column" ? payload.id : event.dataTransfer.getData("text/column");
    if (columnKey) {
      dragRef.current = null;
      setColDragKey(null);
      if (columnKey !== targetUnitKey) reorderColumn(columnKey, targetUnitKey);
      return;
    }
    const caseId = event.dataTransfer.getData("text/card") || dragCardId;
    setDragCardId(null);
    if (!caseId) return;
    const card = allCards.find((c) => c.caseId === caseId);
    if (!card) return;
    if (card.currentUnit === targetUnitKey) return;

    dragRef.current = null;
    setBusyCardId(caseId);
    setResult({});
    const targetUnit = board.units.find((u) => u.key === targetUnitKey);
    const res = await opsFetch<{ toUnitName: string; toStaffName: string | null }>(`/api/v1/ops/cases/${caseId}/refer`, {
      method: "POST",
      csrf,
      idempotencyKey: newIdempotencyKey(),
      body: {
        kind: "unit",
        toUnit: targetUnitKey,
        reason: `جابه‌جایی کارت به واحد ${targetUnit?.name ?? targetUnitKey} از تخته کانبان`,
      },
    });
    setBusyCardId(null);
    if (!res.ok) {
      setResult({ error: `${res.message} — کارت در ستون قبلی ماند` });
      return;
    }
    refresh(`کارت به ${res.data.toUnitName} ارجاع شد و پس از تأیید سرور منتقل شد`);
  }

  return (
    <div className="kanban">
      <div className="kanban-toolbar">
        <span className="small muted">
          {board.stats.total} کارت · {board.stats.overdue} عقب‌افتاده · {board.stats.unassigned} بدون مسئول ·{" "}
          {board.stats.unreadMessages} پیام خوانده‌نشده
        </span>
        <span className="small muted">
          کارت را روی ستون واحد مقصد رها کنید تا ارجاع رسمی ثبت شود · برای جابه‌جایی ستون‌ها، دستهٔ ⠿ سرستون را بکشید و روی
          ستون مقصد رها کنید.
        </span>
      </div>

      <div className="kanban-order-bar">
        <span className="small muted">
          چیدمان ستون‌ها: {local.source === "personal" ? "ترتیب شخصی شما" : "ترتیب پیش‌فرض واحدها"}
          {savingOrder ? " — در حال ذخیره روی سرور…" : ""}
        </span>
        <div className="flex wrap" style={{ gap: 8 }}>
          <button
            type="button"
            className="secondary small"
            disabled={savingOrder}
            onClick={() => void persistColumnOrder(orderForRender, "personal")}
          >
            ذخیره چیدمان من
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={savingOrder}
            onClick={async () => {
              setSavingOrder(true);
              setResult({});
              const res = await opsFetch<{ order: string[] }>("/api/v1/ops/board/columns", {
                method: "PUT",
                csrf,
                body: { reset: true, scope: "personal" },
              });
              setSavingOrder(false);
              if (!res.ok) {
                setResult({ error: `${res.message} — چیدمان تغییر نکرد` });
                return;
              }
              lastSavedRef.current = [...res.data.order];
              setLocal((prev) => ({ signature: prev.signature, order: res.data.order, source: "default" }));
              setResult({ message: "چیدمان شخصی حذف شد؛ ترتیب پیش‌فرض واحدها اعمال است" });
            }}
          >
            بازگشت به ترتیب پیش‌فرض واحدها
          </button>
          {board.canSetDefaultOrder ? (
            <>
              <button
                type="button"
                className="small"
                disabled={savingOrder}
                onClick={() => void persistColumnOrder(orderForRender, "default")}
              >
                ثبت این ترتیب به‌عنوان پیش‌فرض همه
              </button>
              <button
                type="button"
                className="secondary small"
                disabled={savingOrder}
                onClick={async () => {
                  setSavingOrder(true);
                  setResult({});
                  const res = await opsFetch<{ order: string[] }>("/api/v1/ops/board/columns", {
                    method: "PUT",
                    csrf,
                    body: { reset: true, scope: "default" },
                  });
                  setSavingOrder(false);
                  if (!res.ok) {
                    setResult({ error: `${res.message} — ترتیب پیش‌فرض تغییر نکرد` });
                    return;
                  }
                  lastSavedRef.current = [...res.data.order];
                  setLocal((prev) => ({ signature: prev.signature, order: res.data.order, source: "default" }));
                  setResult({ message: "ترتیب پیش‌فرض واحدها بازنشانی شد" });
                }}
              >
                بازنشانی پیش‌فرض همه
              </button>
            </>
          ) : null}
        </div>
      </div>

      {result.error ? <div className="alert error">{result.error}</div> : null}
      {result.message ? <div className="alert success">{result.message}</div> : null}

      <div className="kanban-scroll">
        {board.columns.map((column) => (
          <KanbanColumn
            key={column.unitKey}
            column={column}
            isDragOver={dragOverUnit === column.unitKey}
            busyCardId={busyCardId}
            onOpen={(card) => setActiveCardId(card.caseId)}
            onDragStart={(event, card) => {
              dragRef.current = { type: "card", id: card.caseId };
              event.dataTransfer.setData("text/card", card.caseId);
              event.dataTransfer.effectAllowed = "move";
              setDragCardId(card.caseId);
              setColDragKey(null);
              setColDropKey(null);
            }}
            onDragEnd={() => {
              dragRef.current = null;
              setDragCardId(null);
              setDragOverUnit(null);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (dragRef.current?.type === "column") {
                setColDropKey(column.unitKey);
                setDragOverUnit(null);
                return;
              }
              setDragOverUnit(column.unitKey);
            }}
            onDragLeave={() => setColDropKey((prev) => (prev === column.unitKey ? null : prev))}
            onDrop={(event) => void dropOnUnit(event, column.unitKey)}
            isColumnDrag={colDragKey === column.unitKey}
            isColumnDrop={colDropKey === column.unitKey && colDragKey !== column.unitKey}
            onColumnDragStart={(event) => {
              dragRef.current = { type: "column", id: column.unitKey };
              event.dataTransfer.setData("text/column", column.unitKey);
              event.dataTransfer.effectAllowed = "move";
              setColDragKey(column.unitKey);
              setDragCardId(null);
              setDragOverUnit(null);
            }}
            onColumnDragEnd={() => {
              dragRef.current = null;
              setColDragKey(null);
              setColDropKey(null);
            }}
          />
        ))}

        {board.inbox.length ? (
          <div className="kanban-col">
            <div className="kanban-col-head">
              <span className="kanban-col-grip muted" aria-hidden="true">
                ·
              </span>
              <span className="kanban-col-name">بدون واحد سازمانی</span>
              <span className="badge muted">{board.inbox.length}</span>
            </div>
            <div className="kanban-col-desc">کارت‌هایی که مسئول آن‌ها واحد سازمانی ثبت‌شده ندارد</div>
            <div className="kanban-cards">
              {board.inbox.map((card) => (
                <KanbanCard
                  key={card.caseId}
                  card={card}
                  busy={busyCardId === card.caseId}
                  onOpen={() => setActiveCardId(card.caseId)}
                  onDragStart={(event) => {
                    // مثل کارت‌های ستون‌ها: هم state و هم dataTransfer (فایرفاکس بدون setData درگ را شروع نمی‌کند)
                    dragRef.current = { type: "card", id: card.caseId };
                    event.dataTransfer.setData("text/card", card.caseId);
                    event.dataTransfer.effectAllowed = "move";
                    setDragCardId(card.caseId);
                    setColDragKey(null);
                    setColDropKey(null);
                  }}
                  onDragEnd={() => {
                    dragRef.current = null;
                    setDragCardId(null);
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {activeCard ? (
        <CardModal
          key={activeCard.caseId}
          card={activeCard}
          csrf={csrf}
          units={units}
          staff={staff}
          onClose={() => setActiveCardId(null)}
          onChanged={(message) => {
            refresh(message);
          }}
        />
      ) : null}
    </div>
  );
}

interface ColumnProps {
  column: BoardColumn;
  isDragOver: boolean;
  busyCardId: string | null;
  onOpen: (card: BoardCard) => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>, card: BoardCard) => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  /** در حال کشیده‌شدن همین ستون */
  isColumnDrag: boolean;
  /** این ستون مقصد رهاکردن ستون دیگری است */
  isColumnDrop: boolean;
  onDragLeave: () => void;
  onColumnDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onColumnDragEnd: () => void;
}

function KanbanColumn({
  column,
  isDragOver,
  busyCardId,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isColumnDrag,
  isColumnDrop,
  onDragLeave,
  onColumnDragStart,
  onColumnDragEnd,
}: ColumnProps) {
  const overdue = column.cards.filter((c) => c.overdue).length;
  const className = [
    "kanban-col",
    isDragOver ? "drag-over" : "",
    isColumnDrag ? "dragging-col" : "",
    isColumnDrop ? "col-drop-target" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="kanban-col-head col-draggable" draggable onDragStart={onColumnDragStart} onDragEnd={onColumnDragEnd}>
        <span className="kanban-col-grip" title="برای جابه‌جایی ستون بکشید" aria-hidden="true">
          ⠿
        </span>
        <span className="kanban-col-name">{column.unitName}</span>
        <span className="flex" style={{ gap: 6, alignItems: "center" }}>
          {overdue ? <span className="badge danger">{overdue} عقب‌افتاده</span> : null}
          <span className="badge muted">{column.cards.length}</span>
        </span>
      </div>
      {column.unitDescription ? <div className="kanban-col-desc">{column.unitDescription}</div> : null}
      <div className="kanban-cards">
        {column.cards.length === 0 ? (
          <div className="kanban-empty">کارتی در این واحد نیست</div>
        ) : (
          column.cards.map((card) => (
            <KanbanCard
              key={card.caseId}
              card={card}
              busy={busyCardId === card.caseId}
              onOpen={() => onOpen(card)}
              onDragStart={(event) => onDragStart(event, card)}
              onDragEnd={onDragEnd}
            />
          ))
        )}
      </div>
    </div>
  );
}

function KanbanCard({
  card,
  busy,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: BoardCard;
  busy: boolean;
  onOpen: () => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const last = card.referralPath[card.referralPath.length - 1];
  return (
    <div
      className={`kard status-${card.kanbanStatus}${busy ? " dragging" : ""}`}
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDoubleClick={onOpen}
    >
      <div className="kard-top">
        <span className="badge info">{SERVICE_KIND_LABELS[card.serviceKind] ?? card.serviceKind}</span>
        <span className={`badge ${statusTone(card.kanbanStatus)}`}>{KANBAN_STATUS_LABELS[card.kanbanStatus] ?? card.kanbanStatus}</span>
      </div>

      <div className="kard-title">
        <Link href={card.caseUrl}>{card.title ?? card.code ?? card.caseId}</Link>
      </div>

      <div className="kard-meta small">
        <span className="mono">{card.code ?? card.caseId}</span> · {card.serviceName}
      </div>

      <div className="kard-meta small">
        مسئول: {card.assignedStaffName ?? <span style={{ color: "var(--warning)" }}>بدون مسئول مشخص</span>}
      </div>

      <div className="kard-meta small">
        اولویت: {PRIORITY_LABELS[card.priority] ?? card.priority}
        {card.dueAt ? ` · مهلت: ${relativeFa(card.dueAt)}` : " · بدون مهلت"}
      </div>

      {last ? (
        <div className="kard-path small">
          مسیر: {last.actorName ?? last.fromName ?? "ورودی"} → {last.toName ?? last.toUnitName}
          {last.at ? ` · ${relativeFa(last.at)}` : ""}
        </div>
      ) : null}

      <div className="kard-flags">
        {card.overdue ? <span className="badge danger">عقب‌افتاده</span> : null}
        {!card.hasOwner ? <span className="badge warning">صف واحد</span> : null}
        {card.unreadMessages ? <span className="badge info">{card.unreadMessages} پیام جدید</span> : null}
        {card.lastMessage ? <span className="small muted">آخرین پیام: {card.lastMessage.authorName ?? "—"}</span> : null}
      </div>

      <div className="kard-actions">
        <button type="button" className="secondary small" onClick={onOpen} disabled={busy}>
          {busy ? "در حال ارجاع…" : "گفت‌وگو و اقدام"}
        </button>
      </div>
    </div>
  );
}

function CardModal({
  card,
  csrf,
  units,
  staff,
  onClose,
  onChanged,
}: {
  card: BoardCard;
  csrf: string;
  units: UnitOption[];
  staff: StaffOption[];
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [conversation, setConversation] = useState<ConversationViewData | null>(null);
  const [ops, setOps] = useState<OpsState>({
    kanbanStatus: card.kanbanStatus,
    statusLabel: KANBAN_STATUS_LABELS[card.kanbanStatus] ?? card.kanbanStatus,
    currentUnitName: card.currentUnitName,
    assignedStaffName: card.assignedStaffName,
    hasOwner: card.hasOwner,
    priority: card.priority,
    dueAt: card.dueAt,
    canAct: card.canAct,
    allowedActions: card.allowedActions,
  });
  const [tab, setTab] = useState<"conversation" | "history">("conversation");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadOps = useCallback(async () => {
    setLoading(true);
    const res = await opsFetch<{ ops: OpsState & { allowedActions: string[] }; conversation: ConversationViewData }>(
      `/api/v1/ops/cases/${card.caseId}`,
    );
    setLoading(false);
    if (!res.ok) {
      setLoadError(res.message);
      return;
    }
    setLoadError(null);
    setOps(res.data.ops);
    setConversation(res.data.conversation);
  }, [card.caseId]);

  // بارگذاری تازه جزئیات از سرور (شامل گفت‌وگو و وضعیت خوانده‌شده)
  useEffect(() => {
    void loadOps();
  }, [loadOps]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>{card.title ?? card.code ?? "کارت عملیات"}</h3>
            <div className="small muted">
              <span className="mono">{card.code ?? card.caseId}</span> · {card.serviceName} ·{" "}
              <Link href={card.caseUrl}>پرونده اصلی</Link>
            </div>
          </div>
          <button type="button" className="secondary small" onClick={onClose}>
            بستن
          </button>
        </div>

        <div className="modal-summary">
          <span className={`badge ${statusTone(ops.kanbanStatus)}`}>{KANBAN_STATUS_LABELS[ops.kanbanStatus] ?? ops.kanbanStatus}</span>
          <span className="badge muted">واحد: {ops.currentUnitName ?? "—"}</span>
          <span className="badge muted">مسئول: {ops.assignedStaffName ?? "بدون مسئول مشخص"}</span>
          <span className="badge muted">اولویت: {PRIORITY_LABELS[card.priority] ?? card.priority}</span>
          <span className="badge muted">مهلت: {card.dueAt ? toJalaliDateTime(card.dueAt) : "—"}</span>
          {card.overdue ? <span className="badge danger">عقب‌افتاده</span> : null}
        </div>

        {loadError ? <div className="alert error">{loadError}</div> : null}
        {loading ? <div className="small muted">در حال بارگذاری از سرور…</div> : null}

        <QuickActions
          caseId={card.caseId}
          csrf={csrf}
          units={units}
          ops={ops}
          onChanged={(message) => {
            onChanged(message);
            void loadOps();
          }}
        />

        <div className="tabs">
          <button type="button" className={tab === "conversation" ? "active" : ""} onClick={() => setTab("conversation")}>
            {OPS_EVENT_TYPE_LABELS.message}
            {card.unreadMessages ? <span className="badge warning">{card.unreadMessages}</span> : null}
          </button>
          <button type="button" className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
            مسیر و تاریخچه ارجاع
          </button>
        </div>

        {tab === "conversation" ? (
          <Conversation
            caseId={card.caseId}
            csrf={csrf}
            initial={conversation}
            staff={staff}
            compact
          />
        ) : (
          <ReferralPath card={card} />
        )}
      </div>
    </div>
  );
}

/** مسیر قابل نمایش: مریم رضایی → سارا احمدی → امیر حسینی با جزئیات هر گام */
export function ReferralPath({ card }: { card: BoardCard }) {
  if (!card.referralPath.length) {
    return <div className="referral-path empty">مسیر ارجاعی ثبت نشده است (کارت در واحد اولیه).</div>;
  }
  return (
    <div className="referral-path">
      <div className="rp-title">
        مسیر ارجاع —{" "}
        {card.referralPath
          .map((node) => node.actorName ?? node.fromName ?? "ورودی")
          .concat(card.referralPath[card.referralPath.length - 1].toName ?? card.referralPath[card.referralPath.length - 1].toUnitName ?? "")
          .join(" → ")}
      </div>
      <ol className="rp-list">
        {card.referralPath.map((node) => (
          <li key={node.id}>
            <div className="rp-head">
              <span className={`badge ${node.kind === "colleague" ? "info" : "muted"}`}>{REFERRAL_KIND_LABELS[node.kind]}</span>
              <b>{node.actorName ?? node.fromName ?? "ورودی"}</b>
              <span className="rp-arrow">→</span>
              <b>{node.toName ?? node.toUnitName}</b>
              <span className="rp-time small muted">
                گام {node.depth} · {relativeFa(node.at)}
              </span>
            </div>
            <div className="rp-detail small">
              {node.reason ? <div>علت ارجاع: {node.reason}</div> : null}
              {node.description ? <div>شرح کار: {node.description}</div> : null}
              {node.expectedOutput ? <div>خروجی مورد انتظار: {node.expectedOutput}</div> : null}
              {node.note ? <div>یادداشت داخلی: {node.note}</div> : null}
              <div className="muted">
                از واحد {node.fromUnitName ?? "—"} به واحد {node.toUnitName ?? node.toUnit}
                {node.fromName ? ` · مسئول قبلی: ${node.fromName}` : " · مسئول قبلی: نداشت"}
                {node.toName ? ` · مسئول تازه: ${node.toName}` : " · بدون مسئول مشخص (صف واحد)"}
              </div>
              <div className="muted">
                وضعیت قبل: {node.statusBefore ? KANBAN_STATUS_LABELS[node.statusBefore] ?? node.statusBefore : "—"} → وضعیت بعد:{" "}
                {node.statusAfter ? KANBAN_STATUS_LABELS[node.statusAfter] ?? node.statusAfter : "—"}
              </div>
              {node.outcomeNote ? <div>نتیجه/علت برگشت: {node.outcomeNote}</div> : null}
              {node.priority || node.dueAt ? (
                <div className="muted">
                  {node.priority ? `اولویت ارجاع: ${PRIORITY_LABELS[node.priority] ?? node.priority}` : ""}
                  {node.dueAt ? ` · مهلت: ${toJalaliDateTime(node.dueAt)}` : ""}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
