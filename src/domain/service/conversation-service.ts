/**
 * سرویس گفت‌وگوی داخلی پرونده + منشن همکاران.
 *
 * قواعد پیاده‌شده:
 *  - هر پیام به یک پرونده واقعی گره می‌خورد (شناسه پرونده اعتبارسنجی می‌شود).
 *  - منشن فقط کارمندان فعال را هدف می‌گیرد، اعلان را تنها در صورت داشتن مجوز
 *    مشاهده پرونده می‌فرستد و **مسئولیت عملیات را منتقل نمی‌کند**.
 *  - پیام‌ها هرگز به پیام مشتری (SMS/سینک/وب‌هوک) راه پیدا نمی‌کنند؛ در جدول
 *    اختصاصی `case_messages` با visibility داخلی ذخیره می‌شوند.
 *  - ویرایش/حذف نرم با ثبت در audit_log؛ حذف فیزیکی رویداد حسابرسی را از بین نمی‌برد.
 */
import { AppError } from "@/lib/errors";
import { nowIso } from "@/db/client";
import * as Cases from "@/db/repos/cases";
import * as People from "@/db/repos/people";
import * as Platform from "@/db/repos/platform";
import * as Referrals from "@/db/repos/referrals";
import * as Conv from "@/db/repos/conversations";
import { canViewCase, caseLink, notifyStaff } from "./ops-notify";
import type { ActorContext } from "@/domain/engine/types";

export interface MentionTarget {
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
  mentions: MentionTarget[];
}

function assertCase(caseId: string): Cases.CaseRow {
  const row = Cases.findCaseById(caseId);
  if (!row) throw new AppError("NOT_FOUND", "پرونده یافت نشد");
  return row;
}

/** نگاشت متن به هدف منشن: با شناسه کارمند یا با «@نام کامل» */
function resolveMentions(text: string, explicitIds: string[]): string[] {
  const found = new Set<string>(explicitIds.filter(Boolean));
  const active = People.listActiveStaff();
  // نام‌های طولانی‌تر اول بررسی می‌شوند تا «سارا احمدی» هم درست پیدا شود
  const byName = active.slice().sort((a, b) => b.full_name.length - a.full_name.length);
  for (const staff of byName) {
    if (text.includes(`@${staff.full_name}`)) found.add(staff.id);
  }
  return [...found];
}

export function mentionTargets(staffIds: string[]): MentionTarget[] {
  const targets: MentionTarget[] = [];
  for (const id of staffIds) {
    const staff = People.findStaffById(id);
    if (!staff) continue;
    const unit = staff.org_unit ? Referrals.getOrgUnit(staff.org_unit) : null;
    targets.push({ staffId: staff.id, fullName: staff.full_name, unitKey: staff.org_unit, unitName: unit?.name ?? null });
  }
  return targets;
}

/** کلید بازپخش پیام، به تفکیک پرونده/نویسنده/کلید درخواست */
function messageScope(caseId: string, actorId: string | undefined | null, key: string): string {
  return `ops-message:${caseId}:${actorId ?? "anon"}:${key}`;
}

export interface PostMessageInput {
  caseId: string;
  actor: ActorContext;
  body: string;
  mentionStaffIds?: string[];
  idempotencyKey?: string | null;
}

export interface PostMessageResult {
  message: MessageView;
  mentioned: string[];
  notified: number;
}

export function postMessage(input: PostMessageInput): PostMessageResult {
  const caseRow = assertCase(input.caseId);
  const body = input.body?.trim() ?? "";
  if (!body) throw new AppError("VALIDATION", "متن پیام خالی است");
  if (body.length > 8000) throw new AppError("VALIDATION", "متن پیام بیش از حد بلند است");
  if (caseRow.status === "closed") throw new AppError("CONFLICT", "پرونده بسته شده و گفت‌وگوی تازه نمی‌پذیرد");

  // بازپخش پاسخ در retry با همان کلید (پیش از بررسی وضعیت بعدی پرونده)
  if (input.idempotencyKey) {
    const previous = Platform.getIdempotentResponse(messageScope(input.caseId, input.actor.id, input.idempotencyKey));
    if (previous?.response) {
      return JSON.parse(previous.response) as PostMessageResult;
    }
  }

  // کارکنان منشن‌شده: فقط کارمندان فعال و فقط برای ایشان اعلان ساخته می‌شود
  const mentionIds = resolveMentions(body, input.mentionStaffIds ?? [])
    .filter((id) => id !== input.actor.id)
    .filter((id) => canViewCase(id, caseRow));

  const message = Conv.insertMessage({
    caseId: input.caseId,
    authorStaffId: input.actor.id ?? null,
    authorName: input.actor.name ?? null,
    body,
    meta: { mentions: mentionIds },
  });

  let notified = 0;
  for (const staffId of mentionIds) {
    Conv.insertMention({ messageId: message.id, caseId: input.caseId, mentionedStaffId: staffId });
    const res = notifyStaff({
      staffId,
      kind: "mention",
      caseId: input.caseId,
      body: `${input.actor.name ?? "کارمند"} شما را در گفت‌وگوی پرونده ${caseRow.code ?? caseRow.title ?? caseRow.id} منشن کرد`,
      link: caseLink(input.caseId, "conversation"),
      dedupeKey: `ops:mention:${message.id}:${staffId}`,
      caseRow,
    });
    if (res?.created) notified += 1;
  }

  // اعلان پیام جدید به مسئول فعلی و مشارکت‌کنندگان زنجیره ارجاع (به‌جز نویسنده و منشن‌شده‌ها)
  const participants = new Set<string>();
  if (caseRow.assigned_staff_id) participants.add(caseRow.assigned_staff_id);
  for (const ref of Referrals.listReferralsForCase(input.caseId)) {
    if (ref.to_staff_id) participants.add(ref.to_staff_id);
    if (ref.from_staff_id) participants.add(ref.from_staff_id);
  }
  for (const staffId of participants) {
    if (staffId === input.actor.id || mentionIds.includes(staffId)) continue;
    const res = notifyStaff({
      staffId,
      kind: "message.new",
      caseId: input.caseId,
      body: `پیام تازه در گفت‌وگوی پرونده ${caseRow.code ?? caseRow.title ?? caseRow.id}`,
      link: caseLink(input.caseId, "conversation"),
      dedupeKey: `ops:message:${message.id}:${staffId}`,
      caseRow,
    });
    if (res?.created) notified += 1;
  }

  Platform.writeAudit({
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    actorName: input.actor.name ?? null,
    action: "ops.message.send",
    entityType: "case",
    entityId: input.caseId,
    detail: { messageId: message.id, mentions: mentionIds.length },
  });

  const result: PostMessageResult = {
    message: toView(message, input.actor, mentionIds),
    mentioned: mentionIds,
    notified,
  };
  if (input.idempotencyKey) {
    Platform.saveIdempotentResponse(messageScope(input.caseId, input.actor.id, input.idempotencyKey), "ops-message", 200, result);
  }
  return result;
}

function toView(row: Conv.CaseMessageRow, actor: ActorContext, mentionIds?: string[]): MessageView {
  const ids = mentionIds ?? Conv.listMentionsForMessage(row.id).map((m) => m.mentioned_staff_id);
  return {
    id: row.id,
    caseId: row.case_id,
    authorStaffId: row.author_staff_id,
    authorName: row.author_name ?? "کارمند",
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deleted: Boolean(row.deleted_at),
    isMine: Boolean(actor.id && row.author_staff_id === actor.id),
    mentions: mentionTargets(ids),
  };
}

export interface ConversationView {
  caseId: string;
  messages: MessageView[];
  unread: number;
  mentionedMe: string[];
  participants: MentionTarget[];
  canPost: boolean;
}

/** خواندن گفت‌وگو + به‌روزرسانی وضعیت خوانده‌شدن برای همین کارمند */
export function getConversation(
  caseId: string,
  actor: ActorContext,
  opts: { markRead?: boolean; limit?: number } = {},
): ConversationView {
  const caseRow = assertCase(caseId);
  const rows = Conv.listMessages(caseId, { limit: opts.limit ?? 200 });
  const mine = actor.id ?? "";
  const unreadBefore = mine ? (Conv.unreadCountsByCase(mine, [caseId])[caseId] ?? 0) : 0;

  if (opts.markRead && mine) {
    Conv.markConversationRead(caseId, mine, nowIso());
  }

  const mentionedMe = mine
    ? Conv.listMentionsForCase(caseId)
        .filter((m) => m.mentioned_staff_id === mine)
        .map((m) => m.message_id)
    : [];

  const participants = new Map<string, MentionTarget>();
  for (const row of rows) {
    if (row.author_staff_id) {
      for (const t of mentionTargets([row.author_staff_id])) participants.set(t.staffId, t);
    }
  }
  if (caseRow.assigned_staff_id) {
    for (const t of mentionTargets([caseRow.assigned_staff_id])) participants.set(t.staffId, t);
  }

  return {
    caseId,
    messages: rows.map((row) => toView(row, actor)),
    unread: unreadBefore,
    mentionedMe,
    participants: [...participants.values()],
    canPost: caseRow.status !== "closed" && canViewCase(mine, caseRow),
  };
}

/** ویرایش پیام — فقط نویسنده (یا مدیر)؛ متن قبلی در audit_log می‌ماند */
export function editMessage(input: { messageId: string; actor: ActorContext; body: string }): MessageView {
  const message = Conv.findMessageById(input.messageId);
  if (!message || message.deleted_at) throw new AppError("NOT_FOUND", "پیام یافت نشد");
  if (input.actor.type !== "admin" && message.author_staff_id !== input.actor.id) {
    throw new AppError("FORBIDDEN", "فقط نویسنده پیام می‌تواند آن را ویرایش کند");
  }
  const body = input.body?.trim() ?? "";
  if (!body) throw new AppError("VALIDATION", "متن پیام خالی است");

  Conv.updateMessageBody(message.id, body);
  Platform.writeAudit({
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    actorName: input.actor.name ?? null,
    action: "ops.message.edit",
    entityType: "case",
    entityId: message.case_id,
    detail: { messageId: message.id, previousBody: message.body, newBody: body },
  });
  const updated = Conv.findMessageById(message.id)!;
  return toView(updated, input.actor);
}

/** حذف نرم پیام (تاریخچه حسابرسی حفظ می‌شود) */
export function deleteMessage(input: { messageId: string; actor: ActorContext }): { id: string; deleted: true } {
  const message = Conv.findMessageById(input.messageId);
  if (!message || message.deleted_at) throw new AppError("NOT_FOUND", "پیام یافت نشد");
  if (input.actor.type !== "admin" && message.author_staff_id !== input.actor.id) {
    throw new AppError("FORBIDDEN", "فقط نویسنده پیام می‌تواند آن را حذف کند");
  }
  Conv.softDeleteMessage(message.id, input.actor.id ?? null);
  Platform.writeAudit({
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    actorName: input.actor.name ?? null,
    action: "ops.message.delete",
    entityType: "case",
    entityId: message.case_id,
    detail: { messageId: message.id, body: message.body },
  });
  return { id: message.id, deleted: true };
}

/** فهرست کارمندان قابل منشن/ارجاع (واحد سازمانی + عنوان) */
export function mentionDirectory() {
  return People.listActiveStaff()
    .filter((staff) => staff.active)
    .map((staff) => {
      const unit = staff.org_unit ? Referrals.getOrgUnit(staff.org_unit) : null;
      return {
        id: staff.id,
        fullName: staff.full_name,
        title: staff.title,
        unitKey: staff.org_unit,
        unitName: unit?.name ?? null,
      };
    });
}
