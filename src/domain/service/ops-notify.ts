/**
 * اعلان‌های داخلی عملیات (کانبان، ارجاع، گفت‌وگو، سررسید).
 *
 * پیاده‌سازی سبک و هم‌راستا با معماری فعلی: اعلان در همان جدول `notifications`
 * با channel='inapp' ذخیره می‌شود و کارمند آن را در «صندوق اعلان» می‌بیند.
 * نبود زیرساخت بلادرنگ، با واکشی دوره‌ای (polling) در UI جبران می‌شود؛
 * WebSocket یا سرویس تازه‌ای اضافه نشده است.
 *
 * قواعد:
 *  - هر اعلان به صفحه پرونده/کانبان لینک دارد.
 *  - `dedupeKey` جلوی اعلان تکراری در اجرای مکرر (زمان‌بند/درخواست تکراری) را می‌گیرد.
 *  - اعلان به کارمندی که مجوز مشاهده پرونده را ندارد فرستاده نمی‌شود.
 */
import * as Platform from "@/db/repos/platform";
import * as People from "@/db/repos/people";
import * as Referrals from "@/db/repos/referrals";
import type { CaseRow } from "@/db/repos/cases";

export type OpsNotificationKind =
  | "referral.new"
  | "referral.queue"
  | "referral.owner_changed"
  | "referral.returned"
  | "referral.done"
  | "referral.cancelled"
  | "referral.rereferred"
  | "mention"
  | "message.new"
  | "ops.due_soon"
  | "ops.overdue";

export interface NotifyInput {
  staffId: string;
  kind: OpsNotificationKind;
  caseId: string;
  body: string;
  link: string;
  dedupeKey?: string | null;
}

/**
 * آیا کارمند مجاز به مشاهده این پرونده است؟ (پیش‌نیاز ارسال اعلان/منشن)
 * سیاست فعلی سامانه: پرونده‌ها برای همه کارمندان فعال قابل مشاهده‌اند
 * (`access_level` روی پرونده محدودیتی برای کارکنان نمی‌سازد). اگر در آینده
 * سیاست محدودسازی اضافه شود، تنها نقطه تغییر همین تابع است.
 */
export function canViewCase(staffId: string, _caseRow: CaseRow | null): boolean {
  const staff = People.findStaffById(staffId);
  return Boolean(staff && staff.active);
}

export function caseLink(caseId: string, anchor?: string): string {
  return `/panel/cases/${caseId}${anchor ? `#${anchor}` : ""}`;
}

/** ارسال اعلان داخلی با کنترل مجوز و dedupe */
export function notifyStaff(input: NotifyInput & { caseRow?: CaseRow | null }): { id: string; created: boolean } | null {
  if (!canViewCase(input.staffId, input.caseRow ?? null)) return null;
  return Platform.insertInboxNotification({
    staffId: input.staffId,
    kind: input.kind,
    template: input.kind,
    body: input.body,
    caseId: input.caseId,
    link: input.link,
    dedupeKey: input.dedupeKey ?? null,
  });
}

/** اعلان به همه کارکنان فعال یک واحد (برای «قرارگیری در صف واحد») */
export function notifyUnit(unitKey: string, input: Omit<NotifyInput, "staffId"> & { caseRow?: CaseRow | null }): number {
  let sent = 0;
  for (const staffId of Referrals.unitStaffIds(unitKey)) {
    // کلید dedupe باید گیرنده را هم در بر بگیرد، وگرنه فقط اولین عضو واحد اعلان می‌گیرد
    const dedupeKey = input.dedupeKey ? `${input.dedupeKey}:${staffId}` : null;
    const result = notifyStaff({ ...input, staffId, dedupeKey, caseRow: input.caseRow ?? null });
    if (result?.created) sent += 1;
  }
  return sent;
}

/* ── پیام‌های آماده (فارسی) ───────────────────────────────────────── */

export function referralBody(target: string, caseLabel: string, reason?: string | null): string {
  const suffix = reason ? ` — علت: ${reason}` : "";
  return `عملیات پرونده ${caseLabel} به ${target} ارجاع شد${suffix}`;
}

export function dueBucketKey(caseId: string, kind: "soon" | "overdue", now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return `ops:${kind}:${caseId}:${day}`;
}

/**
 * زمان‌بند سررسید: اعلان «نزدیک سررسید» (۲۴ ساعت آینده) و «عبور از مهلت».
 * اجرای مکرر اعلان تکراری نمی‌سازد (dedupe روزانه per پرونده).
 */
export function sweepDueOps(now: Date = new Date(), windowHours = 24): { dueSoon: number; overdue: number } {
  const cases = Referrals.listBoardCases({ limit: 5000 });
  const soonLimit = new Date(now.getTime() + windowHours * 3600_000).toISOString();
  const nowIso = now.toISOString();
  let dueSoon = 0;
  let overdue = 0;

  for (const card of cases) {
    if (!card.due_at) continue;
    if (card.kanban_status === "done" || card.kanban_status === "cancelled") continue;
    const label = card.code ?? card.title ?? card.case_id;
    const recipients = card.assigned_staff_id
      ? [card.assigned_staff_id]
      : card.current_unit
        ? Referrals.unitStaffIds(card.current_unit)
        : [];
    if (card.due_at < nowIso) {
      for (const staffId of recipients) {
        const res = Platform.insertInboxNotification({
          staffId,
          kind: "ops.overdue",
          template: "ops.overdue",
          body: `مهلت رسیدگی به عملیات پرونده ${label} گذشته است`,
          caseId: card.case_id,
          link: caseLink(card.case_id, "ops-quick-actions"),
          dedupeKey: `${dueBucketKey(card.case_id, "overdue", now)}:${staffId}`,
        });
        if (res.created) overdue += 1;
      }
      continue;
    }
    if (card.due_at < soonLimit) {
      for (const staffId of recipients) {
        const res = Platform.insertInboxNotification({
          staffId,
          kind: "ops.due_soon",
          template: "ops.due_soon",
          body: `مهلت رسیدگی به عملیات پرونده ${label} نزدیک است`,
          caseId: card.case_id,
          link: caseLink(card.case_id, "ops-quick-actions"),
          dedupeKey: `${dueBucketKey(card.case_id, "soon", now)}:${staffId}`,
        });
        if (res.created) dueSoon += 1;
      }
    }
  }

  return { dueSoon, overdue };
}
