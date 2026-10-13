/**
 * ریپازیتوری گفت‌وگوی داخلی پرونده: پیام، منشن همکار و وضعیت خواندن.
 *
 * جدایی از مشتری: این پیام‌ها در جدول اختصاصی `case_messages` هستند و برخلاف
 * `timeline_events` (که visibility داخلی/خارجی دارد) هرگز در سینک، وب‌هوک خروجی،
 * پیامک و پاسخ‌های مشتری ظاهر نمی‌شوند.
 *
 * ویرایش/حذف: حذف «نرم» است (deleted_at/deleted_by) تا تاریخچه حسابرسی حفظ شود؛
 * ویرایش هم `edited_at` را ثبت می‌کند و متن قبلی در audit_log می‌ماند.
 */
import { all, get, nowIso, run } from "@/db/client";
import { newId } from "@/lib/ids";

export interface CaseMessageRow {
  id: string;
  case_id: string;
  author_staff_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  meta: string;
}

export function insertMessage(input: {
  caseId: string;
  authorStaffId?: string | null;
  authorName?: string | null;
  body: string;
  meta?: unknown;
}): CaseMessageRow {
  const id = newId("msg");
  const now = nowIso();
  run(
    `INSERT INTO case_messages (id, case_id, author_staff_id, author_name, body, created_at, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.caseId, input.authorStaffId ?? null, input.authorName ?? null, input.body, now, JSON.stringify(input.meta ?? {})],
  );
  return findMessageById(id)!;
}

export function findMessageById(id: string): CaseMessageRow | null {
  return get<CaseMessageRow>("SELECT * FROM case_messages WHERE id = ?", [id]);
}

export function listMessages(caseId: string, opts: { limit?: number; after?: string | null } = {}): CaseMessageRow[] {
  const params: Array<string | number> = [caseId];
  let clauses = "case_id = ?";
  if (opts.after) {
    clauses += " AND created_at > ?";
    params.push(opts.after);
  }
  params.push(opts.limit ?? 200);
  return all<CaseMessageRow>(`SELECT * FROM case_messages WHERE ${clauses} ORDER BY created_at ASC LIMIT ?`, params);
}

export function updateMessageBody(id: string, body: string): void {
  run("UPDATE case_messages SET body = ?, edited_at = ? WHERE id = ?", [body, nowIso(), id]);
}

/** حذف نرم — ردیف و تاریخچه حسابرسی باقی می‌ماند */
export function softDeleteMessage(id: string, staffId: string | null): void {
  run("UPDATE case_messages SET deleted_at = ?, deleted_by = ? WHERE id = ?", [nowIso(), staffId ?? null, id]);
}

/* ── منشن ─────────────────────────────────────────────────────────── */

export interface MentionRow {
  id: string;
  message_id: string;
  case_id: string;
  mentioned_staff_id: string;
  notified: number;
  created_at: string;
}

export function insertMention(input: {
  messageId: string;
  caseId: string;
  mentionedStaffId: string;
  notified?: boolean;
}): string {
  const existing = get<MentionRow>("SELECT * FROM case_message_mentions WHERE message_id = ? AND mentioned_staff_id = ?", [
    input.messageId,
    input.mentionedStaffId,
  ]);
  if (existing) return existing.id;
  const id = newId("men");
  run(
    `INSERT INTO case_message_mentions (id, message_id, case_id, mentioned_staff_id, notified, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.messageId, input.caseId, input.mentionedStaffId, input.notified ? 1 : 0, nowIso()],
  );
  return id;
}

export function listMentionsForMessage(messageId: string): MentionRow[] {
  return all<MentionRow>("SELECT * FROM case_message_mentions WHERE message_id = ?", [messageId]);
}

export function listMentionsForCase(caseId: string): MentionRow[] {
  return all<MentionRow>("SELECT * FROM case_message_mentions WHERE case_id = ? ORDER BY created_at ASC", [caseId]);
}

/** منشن‌های خوانده‌نشده یک کارمند (برای شمارنده اعلان) */
export function countUnreadMentions(staffId: string, sinceIso?: string): number {
  const params: string[] = [staffId];
  let extra = "";
  if (sinceIso) {
    extra = " AND m.created_at > ?";
    params.push(sinceIso);
  }
  return (
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM case_message_mentions m
       JOIN case_messages msg ON msg.id = m.message_id
       WHERE m.mentioned_staff_id = ? AND msg.deleted_at IS NULL${extra}`,
      params,
    )?.n ?? 0
  );
}

/* ── وضعیت خواندن گفت‌وگو ─────────────────────────────────────────── */

export function markConversationRead(caseId: string, staffId: string, at?: string): void {
  const now = at ?? nowIso();
  run(
    `INSERT INTO case_conversation_reads (case_id, staff_id, last_read_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(case_id, staff_id) DO UPDATE SET
       last_read_at = CASE WHEN excluded.last_read_at > last_read_at THEN excluded.last_read_at ELSE last_read_at END,
       updated_at = excluded.updated_at`,
    [caseId, staffId, now, now],
  );
}

export function getConversationRead(caseId: string, staffId: string): string | null {
  return (
    get<{ last_read_at: string }>("SELECT last_read_at FROM case_conversation_reads WHERE case_id = ? AND staff_id = ?", [
      caseId,
      staffId,
    ])?.last_read_at ?? null
  );
}

/**
 * شمار پیام‌های خوانده‌نشده هر پرونده برای یک کارمند
 * (پیام‌های نویسنده خودش و پیام‌های حذف‌شده شمرده نمی‌شوند)
 */
export function unreadCountsByCase(staffId: string, caseIds?: string[]): Record<string, number> {
  const params: string[] = [staffId, staffId];
  let filter = "";
  if (caseIds?.length) {
    filter = ` AND m.case_id IN (${caseIds.map(() => "?").join(", ")})`;
    params.push(...caseIds);
  }
  const rows = all<{ case_id: string; n: number }>(
    `SELECT m.case_id AS case_id, COUNT(*) AS n
     FROM case_messages m
     LEFT JOIN case_conversation_reads r ON r.case_id = m.case_id AND r.staff_id = ?
     WHERE m.deleted_at IS NULL
       AND (m.author_staff_id IS NULL OR m.author_staff_id != ?)
       AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)${filter}
     GROUP BY m.case_id`,
    params,
  );
  const out: Record<string, number> = {};
  for (const row of rows) out[row.case_id] = row.n;
  return out;
}

/** آخرین پیام‌های چند پرونده (برای پیش‌نمایش روی کارت) */
export function latestMessagesForCases(caseIds: string[]): Array<{ case_id: string; body: string; author_name: string | null; created_at: string }> {
  if (!caseIds.length) return [];
  const placeholders = caseIds.map(() => "?").join(", ");
  return all<{ case_id: string; body: string; author_name: string | null; created_at: string }>(
    `SELECT m.case_id, m.body, m.author_name, m.created_at
     FROM case_messages m
     JOIN (
       SELECT case_id, MAX(created_at) AS last_at FROM case_messages
       WHERE case_id IN (${placeholders}) AND deleted_at IS NULL GROUP BY case_id
     ) t ON t.case_id = m.case_id AND t.last_at = m.created_at
     WHERE m.deleted_at IS NULL
     ORDER BY m.created_at DESC`,
    caseIds,
  );
}
