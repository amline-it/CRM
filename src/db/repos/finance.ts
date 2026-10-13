/**
 * ریپازیتوری مالی: فاکتور، پرداخت، اشتراک، کدهای ریفرال/معافیت.
 */
import { all, get, jsonParse, nowIso, run } from "@/db/client";
import { newId } from "@/lib/ids";

export interface InvoiceRow {
  id: string;
  case_id: string;
  title: string;
  amount: number;
  status: "unpaid" | "paid" | "void";
  method: string | null;
  created_at: string;
  paid_at: string | null;
}

export function listInvoices(caseId: string): InvoiceRow[] {
  return all<InvoiceRow>("SELECT * FROM invoices WHERE case_id = ? ORDER BY created_at ASC", [caseId]);
}

export function createInvoice(entry: { caseId: string; title: string; amount: number; method?: string | null }): string {
  const id = newId("inv");
  run(
    `INSERT INTO invoices (id, case_id, title, amount, status, method, created_at) VALUES (?, ?, ?, ?, 'unpaid', ?, ?)`,
    [id, entry.caseId, entry.title, entry.amount, entry.method ?? null, nowIso()],
  );
  return id;
}

export function markInvoicePaid(id: string, method?: string | null): void {
  run("UPDATE invoices SET status = 'paid', method = ?, paid_at = ? WHERE id = ?", [method ?? null, nowIso(), id]);
}

export interface PaymentRow {
  id: string;
  case_id: string;
  invoice_id: string | null;
  method: "direct" | "subscription" | "referral" | "free";
  amount: number;
  status: "pending" | "succeeded" | "failed";
  provider: string | null;
  provider_ref: string | null;
  error: string | null;
  attempt: number;
  paid_at: string | null;
  created_at: string;
}

export function listPayments(caseId: string): PaymentRow[] {
  return all<PaymentRow>("SELECT * FROM payments WHERE case_id = ? ORDER BY created_at ASC", [caseId]);
}

export function createPayment(entry: {
  caseId: string;
  invoiceId?: string | null;
  method: PaymentRow["method"];
  amount: number;
  status?: PaymentRow["status"];
  provider?: string | null;
  providerRef?: string | null;
  error?: string | null;
  attempt?: number;
}): string {
  const id = newId("pay");
  run(
    `INSERT INTO payments (id, case_id, invoice_id, method, amount, status, provider, provider_ref, error, attempt, paid_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.caseId,
      entry.invoiceId ?? null,
      entry.method,
      entry.amount,
      entry.status ?? "pending",
      entry.provider ?? null,
      entry.providerRef ?? null,
      entry.error ?? null,
      entry.attempt ?? 1,
      (entry.status ?? "pending") === "succeeded" ? nowIso() : null,
      nowIso(),
    ],
  );
  return id;
}

export function updatePayment(id: string, patch: { status: PaymentRow["status"]; providerRef?: string | null; error?: string | null }): void {
  run("UPDATE payments SET status = ?, provider_ref = ?, error = ?, paid_at = ? WHERE id = ?", [
    patch.status,
    patch.providerRef ?? null,
    patch.error ?? null,
    patch.status === "succeeded" ? nowIso() : null,
    id,
  ]);
}

export function paymentStats(): { paidToday: number; paidMonth: number; failedMonth: number } {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const paidToday =
    get<{ s: number }>("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'succeeded' AND paid_at >= ?", [
      startOfDay.toISOString(),
    ])?.s ?? 0;
  const paidMonth =
    get<{ s: number }>("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'succeeded' AND paid_at >= ?", [
      startOfMonth.toISOString(),
    ])?.s ?? 0;
  const failedMonth = get<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE status = 'failed' AND created_at >= ?", [
    startOfMonth.toISOString(),
  ])?.n ?? 0;
  return { paidToday, paidMonth, failedMonth };
}

export interface SubscriptionRow {
  id: string;
  user_id: string | null;
  plan_key: string;
  scope: string;
  starts_at: string;
  ends_at: string | null;
  status: "active" | "expired";
  created_at: string;
}

export function activeSubscriptionFor(userId: string | null, serviceKey: string): SubscriptionRow | null {
  if (!userId) return null;
  const rows = all<SubscriptionRow>(
    "SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 5",
    [userId],
  );
  const now = nowIso();
  for (const row of rows) {
    if (row.ends_at && row.ends_at < now) {
      run("UPDATE subscriptions SET status = 'expired' WHERE id = ?", [row.id]);
      continue;
    }
    const scope = jsonParse<string[]>(row.scope, []);
    if (!scope.length || scope.includes(serviceKey) || scope.includes("*")) return row;
  }
  return null;
}

export function createSubscription(entry: {
  userId: string | null;
  planKey: string;
  scope?: string[];
  startsAt?: string;
  endsAt?: string | null;
}): string {
  const id = newId("sub");
  run(
    `INSERT INTO subscriptions (id, user_id, plan_key, scope, starts_at, ends_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      id,
      entry.userId,
      entry.planKey,
      JSON.stringify(entry.scope ?? []),
      entry.startsAt ?? nowIso(),
      entry.endsAt ?? null,
      nowIso(),
    ],
  );
  return id;
}

export function listSubscriptions(userId?: string | null): SubscriptionRow[] {
  if (userId) return all<SubscriptionRow>("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC", [userId]);
  return all<SubscriptionRow>("SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT 100");
}

export interface ReferralRow {
  id: string;
  code: string;
  kind: "referral" | "waiver";
  owner_user_id: string | null;
  scope: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  active: number;
  note: string | null;
  created_at: string;
}

export function findReferralByCode(code: string): ReferralRow | null {
  return get<ReferralRow>("SELECT * FROM referral_codes WHERE code = ?", [code]);
}

export function listReferrals(): ReferralRow[] {
  return all<ReferralRow>("SELECT * FROM referral_codes ORDER BY created_at DESC");
}

export function createReferral(entry: {
  code: string;
  kind?: "referral" | "waiver";
  ownerUserId?: string | null;
  scope?: string[];
  maxUses?: number;
  expiresAt?: string | null;
  note?: string | null;
}): string {
  const id = newId("ref");
  run(
    `INSERT INTO referral_codes (id, code, kind, owner_user_id, scope, max_uses, used_count, expires_at, active, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?)`,
    [
      id,
      entry.code,
      entry.kind ?? "referral",
      entry.ownerUserId ?? null,
      JSON.stringify(entry.scope ?? []),
      entry.maxUses ?? 1,
      entry.expiresAt ?? null,
      entry.note ?? null,
      nowIso(),
    ],
  );
  return id;
}

export function setReferralActive(id: string, active: boolean): void {
  run("UPDATE referral_codes SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
}

export function referralForCase(caseId: string): ReferralRow | null {
  return get<ReferralRow>(
    `SELECT rc.* FROM referral_uses ru JOIN referral_codes rc ON rc.id = ru.code_id WHERE ru.case_id = ? LIMIT 1`,
    [caseId],
  );
}

export function useReferral(codeId: string, caseId: string, approvedBy?: string | null): void {
  const existing = get<{ id: string }>("SELECT id FROM referral_uses WHERE code_id = ? AND case_id = ?", [codeId, caseId]);
  if (existing) return;
  run("INSERT INTO referral_uses (id, code_id, case_id, approved_by, used_at) VALUES (?, ?, ?, ?, ?)", [
    newId("use"),
    codeId,
    caseId,
    approvedBy ?? null,
    nowIso(),
  ]);
  run("UPDATE referral_codes SET used_count = used_count + 1 WHERE id = ?", [codeId]);
}

export function listReferralUses(codeId: string): Array<{ case_id: string; used_at: string }> {
  return all("SELECT case_id, used_at FROM referral_uses WHERE code_id = ? ORDER BY used_at DESC", [codeId]);
}
