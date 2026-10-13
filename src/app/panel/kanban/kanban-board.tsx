"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  KANBAN_STATUS_LABELS,
  KANBAN_STATUS_TONE,
  REFERRAL_KIND_LABELS,
  KANBAN_ACTION_LABELS,
} from "@/lib/fa-labels";
import { relativeFa } from "@/lib/jalali";
import type { Board, BoardCard, BoardColumn } from "@/domain/service/referral-service";
import { referAction, actAction, reorderOrgUnitsAction } from "./actions";

interface StaffOption {
  id: string;
  fullName: string;
  title: string | null;
  unitKey: string | null;
  unitName: string | null;
}

interface UnitOption {
  key: string;
  name: string;
}

interface Props {
  board: Board;
  staff: StaffOption[];
  csrf: string;
  canManageUnits: boolean;
}

const STATUS_ORDER = ["new", "in_review", "waiting_info", "returned_correction", "done"] as const;

export function KanbanBoard({ board, staff, csrf, canManageUnits }: Props) {
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null);
  const [orderedUnitKeys, setOrderedUnitKeys] = useState<string[]>(() => board.units.map((u) => u.key));
  const [dragCard, setDragCard] = useState<{ caseId: string; fromUnit: string | null } | null>(null);
  const [dragColumn, setDragColumn] = useState<string | null>(null);
  const [dragOverUnit, setDragOverUnit] = useState<string | null>(null);
  const [result, setResult] = useState<{ error?: string; message?: string }>({});
  const [, startTransition] = useTransition();
  const router = useRouter();

  // ترتیب موثر ستون‌ها (همیشه شامل همه واحدهای سرور، حتی اگر بعداً اضافه شده باشند)
  const unitColumns = board.columns;
  const effectiveOrder = orderedUnitKeys.filter((k) => unitColumns.some((c) => c.unitKey === k));
  for (const c of unitColumns) if (!effectiveOrder.includes(c.unitKey)) effectiveOrder.push(c.unitKey);

  const inboxCards = board.inbox;
  const total = unitColumns.reduce((n, c) => n + c.cards.length, 0) + inboxCards.length;

  function runCardDrop(e: React.DragEvent<HTMLDivElement>, targetUnit: string) {
    e.preventDefault();
    const columnKey = e.dataTransfer.getData("text/column");
    if (columnKey) {
      handleColumnDrop(columnKey, targetUnit);
      setDragCard(null);
      setDragColumn(null);
      setDragOverUnit(null);
      return;
    }
    const cardId = e.dataTransfer.getData("text/card");
    setDragOverUnit(null);
    if (!cardId) {
      setDragCard(null);
      return;
    }
    if (targetUnit === "__inbox") {
      setDragCard(null);
      return; // نمی‌توان به صندوق ورودی ارجاع داد
    }
    const fromUnit = e.dataTransfer.getData("text/from") || null;
    if (fromUnit === targetUnit) {
      setDragCard(null);
      return; // رها کردن در همان ستون = بی‌اثر
    }
    const fd = new FormData();
    fd.set("_csrf", csrf);
    fd.set("caseId", cardId);
    fd.set("kind", "unit");
    fd.set("toUnit", targetUnit);
    fd.set("reason", "جابه‌جایی کارت با درگ (ارجاع به واحد مقصد)");
    startTransition(async () => {
      const res = await referAction({}, fd);
      setResult(res);
      if (!res.error) router.refresh();
    });
    setDragCard(null);
  }

  function handleColumnDrop(draggedKey: string, targetKey: string) {
    if (draggedKey === targetKey) return;
    const prev = effectiveOrder;
    const from = prev.indexOf(draggedKey);
    const to = prev.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    const arr = [...prev];
    arr.splice(from, 1);
    arr.splice(to, 0, draggedKey);
    setOrderedUnitKeys(arr);
    const fd = new FormData();
    fd.set("_csrf", csrf);
    fd.set("order", arr.join(","));
    startTransition(async () => {
      const res = await reorderOrgUnitsAction({}, fd);
      setResult(res);
    });
  }

  return (
    <div className="kanban">
      <div className="kanban-toolbar">
        <span className="small muted">{total} کارت روی {unitColumns.length + (inboxCards.length ? 1 : 0)} ستون</span>
        <span className="small muted">کارت‌ها را بکشید بین ستون‌ها (ارجاع) و ستون‌ها را از سرستون بکشید (تغییر ترتیب)</span>
      </div>

      {result.error ? <div className="alert error">{result.error}</div> : null}
      {result.message ? <div className="alert success">{result.message}</div> : null}

      <div className="kanban-scroll">
        {effectiveOrder.map((key) => {
          const col = unitColumns.find((c) => c.unitKey === key);
          if (!col) return null;
          return (
            <KanbanColumn
              key={key}
              column={col}
              staff={staff}
              csrf={csrf}
              canManageUnits={canManageUnits}
              isDragOver={dragOverUnit === key}
              isDraggingCol={dragColumn === key}
              onCardDragStart={(e, card) => {
                e.dataTransfer.setData("text/card", card.caseId);
                e.dataTransfer.setData("text/from", card.currentUnit ?? "");
                e.dataTransfer.effectAllowed = "move";
                setDragCard({ caseId: card.caseId, fromUnit: card.currentUnit });
              }}
              onColumnDragStart={(e, k) => {
                e.dataTransfer.setData("text/column", k);
                e.dataTransfer.effectAllowed = "move";
                setDragColumn(k);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOverUnit(key);
              }}
              onDrop={(e) => runCardDrop(e, key)}
              onDragEnd={() => {
                setDragCard(null);
                setDragColumn(null);
                setDragOverUnit(null);
              }}
              onOpenCard={(card) => setActiveCard(card)}
              draggingCardId={dragCard?.caseId ?? null}
            />
          );
        })}

        {inboxCards.length ? (
          <div className="kanban-col">
            <div className="kanban-col-head">
              <span className="kanban-col-name">صندوق ورودی (بدون واحد)</span>
              <span className="badge muted">{inboxCards.length}</span>
            </div>
            <div className="kanban-cards">
              {inboxCards
                .slice()
                .sort(
                  (a, b) =>
                    STATUS_ORDER.indexOf(a.kanbanStatus as (typeof STATUS_ORDER)[number]) -
                    STATUS_ORDER.indexOf(b.kanbanStatus as (typeof STATUS_ORDER)[number]),
                )
                .map((card) => (
                  <KanbanCard
                    key={card.caseId}
                    card={card}
                    onOpen={() => setActiveCard(card)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/card", card.caseId);
                      e.dataTransfer.setData("text/from", card.currentUnit ?? "");
                      e.dataTransfer.effectAllowed = "move";
                      setDragCard({ caseId: card.caseId, fromUnit: card.currentUnit });
                    }}
                    onDragEnd={() => setDragCard(null)}
                    dragging={false}
                  />
                ))}
            </div>
          </div>
        ) : null}
      </div>

      {activeCard ? (
        <CardModal card={activeCard} staff={staff} units={board.units} csrf={csrf} onClose={() => setActiveCard(null)} onDone={() => { setActiveCard(null); router.refresh(); }} />
      ) : null}
    </div>
  );
}

interface ColumnProps {
  column: BoardColumn;
  staff: StaffOption[];
  csrf: string;
  canManageUnits: boolean;
  isDragOver: boolean;
  isDraggingCol: boolean;
  onCardDragStart: (e: React.DragEvent<HTMLDivElement>, card: BoardCard) => void;
  onColumnDragStart: (e: React.DragEvent<HTMLDivElement>, key: string) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onOpenCard: (card: BoardCard) => void;
  draggingCardId: string | null;
}

function KanbanColumn({
  column,
  staff,
  csrf,
  canManageUnits,
  isDragOver,
  isDraggingCol,
  onCardDragStart,
  onColumnDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onOpenCard,
  draggingCardId,
}: ColumnProps) {
  return (
    <div
      className={`kanban-col${isDragOver ? " drag-over" : ""}${isDraggingCol ? " dragging-col" : ""}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div
        className={`kanban-col-head${canManageUnits ? " col-draggable" : ""}`}
        draggable={canManageUnits}
        onDragStart={(e) => onColumnDragStart(e, column.unitKey)}
      >
        <span className="kanban-col-name">{column.unitName}</span>
        <span className="badge muted">{column.cards.length}</span>
      </div>
      {column.unitDescription ? <div className="kanban-col-desc">{column.unitDescription}</div> : null}
      <div className="kanban-cards">
        {column.cards.length === 0 ? (
          <div className="kanban-empty">کارتی نیست</div>
        ) : (
          column.cards
            .slice()
            .sort(
              (a, b) =>
                STATUS_ORDER.indexOf(a.kanbanStatus as (typeof STATUS_ORDER)[number]) -
                STATUS_ORDER.indexOf(b.kanbanStatus as (typeof STATUS_ORDER)[number]),
            )
            .map((card) => (
              <KanbanCard
                key={card.caseId}
                card={card}
                onOpen={() => onOpenCard(card)}
                onDragStart={(e) => onCardDragStart(e, card)}
                onDragEnd={onDragEnd}
                dragging={draggingCardId === card.caseId}
              />
            ))
        )}
      </div>
    </div>
  );
}

interface CardProps {
  card: BoardCard;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  dragging: boolean;
}

function KanbanCard({ card, onOpen, onDragStart, onDragEnd, dragging }: CardProps) {
  const tone = KANBAN_STATUS_TONE[card.kanbanStatus] ?? "muted";
  const last = card.referralPath[card.referralPath.length - 1];
  return (
    <div
      className={`kard status-${card.kanbanStatus}${dragging ? " dragging" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="kard-top">
        <span className="badge info">{card.serviceName}</span>
        <span className={`badge ${tone}`}>{KANBAN_STATUS_LABELS[card.kanbanStatus] ?? card.kanbanStatus}</span>
      </div>
      <div className="kard-title">
        <Link href={`/panel/cases/${card.caseId}`}>{card.title ?? card.code ?? card.caseId}</Link>
      </div>
      {card.code ? <div className="kard-code mono small">{card.code}</div> : null}
      <div className="kard-meta small">
        مسئول: {card.assignedStaffName ?? (card.currentUnitName ? `واحد ${card.currentUnitName}` : "—")}
      </div>
      {last ? (
        <div className="kard-path small">
          مسیر: {last.fromName ?? last.fromUnitName ?? "ورودی"} → {last.toName ?? last.toUnitName}
        </div>
      ) : null}
      <div className="kard-actions">
        <button type="button" className="secondary small" onClick={onOpen} disabled={!card.canAct}>
          {card.canAct ? "اقدام سریع" : "فقط مسئول"}
        </button>
      </div>
    </div>
  );
}

function CardModal({
  card,
  staff,
  units,
  csrf,
  onClose,
  onDone,
}: {
  card: BoardCard;
  staff: StaffOption[];
  units: UnitOption[];
  csrf: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [referKind, setReferKind] = useState<"colleague" | "unit">("unit");
  const [referTarget, setReferTarget] = useState<string>("");
  const [result, setResult] = useState<{ error?: string; message?: string }>({});
  const [busy, startTransition] = useTransition();

  // گروه‌بندی همکاران بر اساس واحد (برای انتخاب مقصد)
  const staffByUnit = new Map<string, StaffOption[]>();
  for (const s of staff) {
    const key = s.unitName ?? "";
    if (!staffByUnit.has(key)) staffByUnit.set(key, []);
    staffByUnit.get(key)!.push(s);
  }

  const detectedUnit =
    referKind === "colleague"
      ? staff.find((s) => s.id === referTarget)?.unitName ?? null
      : (units.find((u) => u.key === referTarget)?.name ?? null);

  function runRefer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!card.canAct) return;
    const fd = new FormData(e.currentTarget);
    fd.set("_csrf", csrf);
    startTransition(async () => {
      const res = await referAction({}, fd);
      setResult(res);
      if (!res.error) onDone();
    });
  }

  function runAct(action: string) {
    if (!card.canAct) return;
    const fd = new FormData();
    fd.set("_csrf", csrf);
    fd.set("caseId", card.caseId);
    fd.set("action", action);
    const reasonEl = document.getElementById(`act-reason-${card.caseId}`) as HTMLTextAreaElement | null;
    if (reasonEl?.value) fd.set("reason", reasonEl.value);
    startTransition(async () => {
      const res = await actAction({}, fd);
      setResult(res);
      if (!res.error) onDone();
    });
  }

  if (!card.canAct) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h3>{card.title ?? card.code ?? "کارت"}</h3>
            <button className="secondary small" onClick={onClose}>بستن</button>
          </div>
          <div className="alert warning">شما مسئول این پرونده نیستید؛ فقط مسئول واحد/همکار مقصد مجاز به اقدام است.</div>
          <ReferralPath card={card} />
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>{card.title ?? card.code ?? "کارت"}</h3>
            <div className="small muted">{card.serviceName}{card.code ? ` · ${card.code}` : ""}</div>
          </div>
          <button className="secondary small" onClick={onClose}>بستن</button>
        </div>

        <div className="alert-row">
          {result.error ? <div className="alert error">{result.error}</div> : null}
          {result.message ? <div className="alert success">{result.message}</div> : null}
        </div>

        <ReferralPath card={card} />

        {/* باکس اقدام سریع — ارجاع (نوع ارجاع: همکار / واحد) */}
        <div className="quick-box">
          <div className="quick-box-title">باکس اقدام سریع — ارجاع</div>
          <form onSubmit={runRefer} className="refer-form">
            <input type="hidden" name="_csrf" value={csrf} />
            <input type="hidden" name="caseId" value={card.caseId} />
            <div className="form-row">
              <div className="field">
                <label>نوع ارجاع</label>
                <select name="kind" value={referKind} onChange={(e) => { setReferKind(e.target.value as "colleague" | "unit"); setReferTarget(""); }}>
                  <option value="unit">به واحد</option>
                  <option value="colleague">به همکار</option>
                </select>
              </div>
              <div className="field">
                <label>{referKind === "colleague" ? "همکار مقصد" : "واحد مقصد"}</label>
                {referKind === "colleague" ? (
                  <select name="toStaffId" value={referTarget} onChange={(e) => setReferTarget(e.target.value)} required>
                    <option value="">انتخاب همکار…</option>
                    {[...staffByUnit.entries()].map(([unitName, list]) => (
                      <optgroup key={unitName} label={unitName}>
                        {list.map((s) => (
                          <option key={s.id} value={s.id}>{s.fullName}{s.title ? ` (${s.title})` : ""}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                ) : (
                  <select name="toUnit" value={referTarget} onChange={(e) => setReferTarget(e.target.value)} required>
                    <option value="">انتخاب واحد…</option>
                    {units.map((u) => (
                      <option key={u.key} value={u.key}>{u.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            {detectedUnit ? (
              <div className="detected-unit">
                واحد سازمانی تشخیص‌داده‌شده: <b>{detectedUnit}</b>
              </div>
            ) : null}
            <div className="field">
              <label>علت ارجاع (اختیاری)</label>
              <textarea name="reason" rows={2} placeholder="دلیل ارجاع به واحد/همکار مقصد" />
            </div>
            <button type="submit" className="small" disabled={busy || !referTarget}>
              {busy ? "…" : "ثبت ارجاع"}
            </button>
          </form>
        </div>

        {/* اقدام مسئول جدید */}
        <div className="quick-box">
          <div className="quick-box-title">اقدام مسئول جدید — وضعیت کارت</div>
          <div className="actions-grid">
            <button type="button" className="secondary small" disabled={busy} onClick={() => runAct("start_review")}>{KANBAN_ACTION_LABELS.start_review}</button>
            <button type="button" className="secondary small" disabled={busy} onClick={() => runAct("need_info")}>{KANBAN_ACTION_LABELS.need_info}</button>
            <button type="button" className="secondary small" disabled={busy} onClick={() => runAct("return_correction")}>{KANBAN_ACTION_LABELS.return_correction}</button>
            <button type="button" className="success small" disabled={busy} onClick={() => runAct("complete")}>{KANBAN_ACTION_LABELS.complete}</button>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>یادداشت اقدام (اختیاری)</label>
            <textarea id={`act-reason-${card.caseId}`} rows={2} placeholder="توضیح اقدام مسئول" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ReferralPath({ card }: { card: BoardCard }) {
  if (!card.referralPath.length) {
    return <div className="referral-path empty">مسیر ارجاعی ثبت نشده است (کارت در واحد اولیه).</div>;
  }
  return (
    <div className="referral-path">
      <div className="rp-title">مسیر ارجاع (ارجاع‌دهنده → گیرنده)</div>
      <ol className="rp-list">
        {card.referralPath.map((node) => (
          <li key={node.depth}>
            <span className={`badge ${node.kind === "colleague" ? "info" : "muted"}`}>{REFERRAL_KIND_LABELS[node.kind]}</span>
            <b>{node.fromName ?? node.fromUnitName ?? "ورودی"}</b>
            <span className="rp-arrow">→</span>
            <b>{node.toName ?? node.toUnitName}</b>
            {node.reason ? <span className="rp-reason"> — {node.reason}</span> : null}
            <span className="rp-time small muted"> · {relativeFa(node.at)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
