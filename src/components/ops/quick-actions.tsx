"use client";

/**
 * باکس «اقدام سریع» عملیات — ارجاع به همکار/واحد + اقدام‌های وضعیت.
 *
 * همه تغییرها از API با تأیید سرور انجام می‌شود؛ تا پاسخ موفق سرور هیچ تغییری در
 * UI قطعی نمی‌شود و در خطا وضعیت معتبر قبلی نمایش داده می‌شود.
 */
import { useMemo, useState } from "react";
import { opsFetch, newIdempotencyKey } from "./api";
import { KANBAN_ACTION_LABELS, PRIORITY_LABELS } from "@/lib/fa-labels";

export interface UnitOption {
  key: string;
  name: string;
  description?: string | null;
  staff: Array<{ id: string; fullName: string; title?: string | null }>;
}

export interface OpsState {
  kanbanStatus: string;
  statusLabel: string;
  currentUnitName: string | null;
  assignedStaffName: string | null;
  hasOwner: boolean;
  priority?: string | null;
  dueAt?: string | null;
  canAct: boolean;
  allowedActions: string[];
}

interface Props {
  caseId: string;
  csrf: string;
  units: UnitOption[];
  ops: OpsState;
  onChanged: (message: string) => void;
  compact?: boolean;
}

const STATUS_ACTIONS: Array<{ action: string; label: string; className: string; needsReason: boolean }> = [
  { action: "start_review", label: KANBAN_ACTION_LABELS.start_review, className: "small", needsReason: false },
  { action: "need_info", label: KANBAN_ACTION_LABELS.need_info, className: "secondary small", needsReason: false },
  { action: "return_correction", label: KANBAN_ACTION_LABELS.return_correction, className: "danger small", needsReason: true },
  { action: "complete", label: KANBAN_ACTION_LABELS.complete, className: "success small", needsReason: false },
  { action: "cancel", label: KANBAN_ACTION_LABELS.cancel, className: "secondary small", needsReason: true },
];

export function QuickActions({ caseId, csrf, units, ops, onChanged, compact = false }: Props) {
  const [kind, setKind] = useState<"colleague" | "unit">("unit");
  const [targetUnit, setTargetUnit] = useState("");
  const [targetStaff, setTargetStaff] = useState("");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [priority, setPriority] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [note, setNote] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const allStaff = useMemo(
    () => units.flatMap((unit) => unit.staff.map((s) => ({ ...s, unitKey: unit.key, unitName: unit.name }))),
    [units],
  );
  const unitStaff = useMemo(() => units.find((u) => u.key === targetUnit)?.staff ?? [], [units, targetUnit]);

  const hasHistory = useMemo(() => Boolean(ops.currentUnitName) && ops.kanbanStatus !== "new", [ops]);

  async function submitReferral(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!reason.trim() && !description.trim() && !expectedOutput.trim()) {
      setError("حداقل یکی از موارد «علت ارجاع»، «شرح کار» یا «خروجی مورد انتظار» را وارد کنید");
      return;
    }
    setBusy("refer");
    const result = await opsFetch<{ toUnitName: string; toStaffName: string | null; depth: number; replayed: boolean }>(
      `/api/v1/ops/cases/${caseId}/refer`,
      {
        method: "POST",
        csrf,
        idempotencyKey: newIdempotencyKey(),
        body: {
          kind,
          toUnit: kind === "unit" ? targetUnit : null,
          toStaffId: targetStaff || null,
          reason,
          description,
          expectedOutput,
          priority: priority || null,
          dueAt: dueAt || null,
          note: note || null,
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const dest = result.data.toStaffName ? `همکار ${result.data.toStaffName}` : `واحد ${result.data.toUnitName}`;
    setNotice(
      result.data.replayed
        ? "این ارجاع قبلاً ثبت شده بود؛ ارجاع تکراری ساخته نشد"
        : `ارجاع به ${dest} ثبت شد (گام ${result.data.depth} در تاریخچه)`,
    );
    setReason("");
    setDescription("");
    setExpectedOutput("");
    setNote("");
    setPriority("");
    setDueAt("");
    setTargetStaff("");
    onChanged("ارجاع ثبت شد");
  }

  async function runAction(action: string, needsReason: boolean) {
    setError(null);
    setNotice(null);
    if (needsReason && !actionReason.trim()) {
      setError("برای این اقدام، ثبت علت الزامی است");
      return;
    }
    setBusy(action);
    const result = await opsFetch<{ kanbanStatus: string; statusBefore: string }>(`/api/v1/ops/cases/${caseId}/actions`, {
      method: "POST",
      csrf,
      idempotencyKey: newIdempotencyKey(),
      body: { action, reason: actionReason || null, resultNote: actionReason || null },
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setActionReason("");
    const label = KANBAN_ACTION_LABELS[action] ?? action;
    setNotice(`${label} ثبت شد — وضعیت تازه از سرور تأیید شد`);
    onChanged("وضعیت به‌روزرسانی شد");
  }

  return (
    <div className={`quick-box${compact ? " compact" : ""}`}>
      <div className="quick-box-title">
        باکس اقدام سریع
        <span className="small muted">
          واحد فعلی: {ops.currentUnitName ?? "بدون واحد"} · مسئول: {ops.assignedStaffName ?? "بدون مسئول مشخص"} · وضعیت: {ops.statusLabel}
        </span>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      {!ops.canAct ? (
        <div className="alert warning">
          شما مسئول این عملیات نیستید؛ اقدام و ارجاع فقط برای مسئول فعلی یا کارمندان واحد جاری (و مدیر) فعال است.
        </div>
      ) : null}

      <form onSubmit={submitReferral} className="refer-form">
        <div className="form-row">
          <div className="field">
            <label htmlFor={`kind-${caseId}`}>نوع ارجاع</label>
            <select
              id={`kind-${caseId}`}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as "colleague" | "unit");
                setTargetStaff("");
              }}
            >
              <option value="unit">به واحد سازمانی</option>
              <option value="colleague">به همکار مشخص</option>
            </select>
          </div>

          {kind === "unit" ? (
            <>
              <div className="field">
                <label htmlFor={`unit-${caseId}`}>واحد مقصد</label>
                <select id={`unit-${caseId}`} value={targetUnit} onChange={(e) => { setTargetUnit(e.target.value); setTargetStaff(""); }} required>
                  <option value="">انتخاب واحد…</option>
                  {units.map((unit) => (
                    <option key={unit.key} value={unit.key}>{unit.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`owner-${caseId}`}>مسئول مشخص (اختیاری)</label>
                <select id={`owner-${caseId}`} value={targetStaff} onChange={(e) => setTargetStaff(e.target.value)} disabled={!targetUnit}>
                  <option value="">بدون مسئول — صف واحد</option>
                  {unitStaff.map((s) => (
                    <option key={s.id} value={s.id}>{s.fullName}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <div className="field">
              <label htmlFor={`staff-${caseId}`}>همکار مقصد</label>
              <select id={`staff-${caseId}`} value={targetStaff} onChange={(e) => setTargetStaff(e.target.value)} required>
                <option value="">انتخاب همکار…</option>
                {units.map((unit) => (
                  <optgroup key={unit.key} label={unit.name}>
                    {unit.staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.fullName}{s.title ? ` (${s.title})` : ""}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor={`reason-${caseId}`}>علت ارجاع</label>
            <input id={`reason-${caseId}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً بررسی حقوقی بندهای قرارداد" />
          </div>
          <div className="field">
            <label htmlFor={`priority-${caseId}`}>اولویت</label>
            <select id={`priority-${caseId}`} value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">بدون تغییر</option>
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`due-${caseId}`}>مهلت</label>
            <input id={`due-${caseId}`} type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor={`desc-${caseId}`}>شرح کار</label>
          <textarea id={`desc-${caseId}`} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="چه کارهایی باید انجام شود؟" />
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor={`out-${caseId}`}>خروجی مورد انتظار</label>
            <input id={`out-${caseId}`} value={expectedOutput} onChange={(e) => setExpectedOutput(e.target.value)} placeholder="مثلاً تأیید بندها یا فایل اصلاح‌شده" />
          </div>
          <div className="field">
            <label htmlFor={`note-${caseId}`}>یادداشت داخلی</label>
            <input id={`note-${caseId}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت فقط برای کارکنان" />
          </div>
        </div>

        {allStaff.length === 0 ? <div className="alert warning">هیچ کارمند فعالی با واحد سازمانی ثبت نشده است.</div> : null}

        <button
          type="submit"
          className="small"
          disabled={busy !== null || (kind === "unit" ? !targetUnit : !targetStaff)}
        >
          {busy === "refer" ? "…" : hasHistory ? "ثبت ارجاع مجدد" : "ثبت ارجاع"}
        </button>
      </form>

      <div className="quick-actions-divider" />

      <div className="field">
        <label htmlFor={`act-reason-${caseId}`}>یادداشت اقدام (برای برگشت/لغو الزامی است)</label>
        <textarea id={`act-reason-${caseId}`} rows={2} value={actionReason} onChange={(e) => setActionReason(e.target.value)} placeholder="نتیجه اقدام یا علت برگشت/لغو" />
      </div>
      <div className="actions-grid">
        {STATUS_ACTIONS.map((item) => {
          const allowed = ops.allowedActions.includes(item.action);
          return (
            <button
              key={item.action}
              type="button"
              className={item.className}
              disabled={busy !== null || !ops.canAct || !allowed}
              title={allowed ? undefined : "این گذار وضعیت از وضعیت فعلی مجاز نیست"}
              onClick={() => void runAction(item.action, item.needsReason)}
            >
              {busy === item.action ? "…" : item.label}
            </button>
          );
        })}
      </div>
      <div className="small muted">
        پایان یا لغو عملیات داخلی، وضعیت اصلی خدمت (قرارداد/آگهی/نیازمندی) را تغییر نمی‌دهد.
      </div>
    </div>
  );
}
