/**
 * ریپازیتوری پرونده: پرونده، گذارها، تایم‌لاین، وظایف، مدارک، قرارداد، امضا، کد رهگیری.
 */
import { all, get, jsonParse, nowIso, run } from "@/db/client";
import { newId } from "@/lib/ids";

/* ── پرونده ───────────────────────────────────────────────────────── */

export interface CaseRow {
  id: string;
  code: string | null;
  external_id: string | null;
  source: string | null;
  title: string | null;
  service_key: string;
  workflow_key: string;
  workflow_version: number;
  state: string;
  status: "open" | "closed";
  outcome: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  owner_user_id: string | null;
  agent_user_id: string | null;
  assigned_staff_id: string | null;
  kanban_status: string;
  due_at: string | null;
  requires_tracking: number;
  access_level: string | null;
  queue: string | null;
  attempts_payment: number;
  attempts_tracking: number;
  meta: string;
  opened_at: string;
  closed_at: string | null;
  last_transition_at: string | null;
  created_at: string;
  updated_at: string;
}

export function findCaseById(id: string): CaseRow | null {
  return get<CaseRow>("SELECT * FROM cases WHERE id = ?", [id]);
}

export function findCaseByExternal(source: string, externalId: string): CaseRow | null {
  return get<CaseRow>("SELECT * FROM cases WHERE source = ? AND external_id = ?", [source, externalId]);
}

export function listCases(opts: {
  state?: string;
  states?: string[];
  status?: string;
  queue?: string;
  serviceKey?: string;
  assignedStaffId?: string;
  search?: string;
  priority?: string;
  limit?: number;
  offset?: number;
} = {}): CaseRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.state) {
    clauses.push("state = ?");
    params.push(opts.state);
  }
  if (opts.states?.length) {
    clauses.push(`state IN (${opts.states.map(() => "?").join(", ")})`);
    params.push(...opts.states);
  }
  if (opts.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  if (opts.queue) {
    clauses.push("queue = ?");
    params.push(opts.queue);
  }
  if (opts.serviceKey) {
    clauses.push("service_key = ?");
    params.push(opts.serviceKey);
  }
  if (opts.assignedStaffId) {
    clauses.push("assigned_staff_id = ?");
    params.push(opts.assignedStaffId);
  }
  if (opts.priority) {
    clauses.push("priority = ?");
    params.push(opts.priority);
  }
  if (opts.search) {
    clauses.push("(code LIKE ? OR title LIKE ? OR id LIKE ?)");
    const like = `%${opts.search}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(opts.limit ?? 50, opts.offset ?? 0);
  return all<CaseRow>(`SELECT * FROM cases ${where} ORDER BY COALESCE(due_at, created_at) ASC LIMIT ? OFFSET ?`, params);
}

export function countCasesByState(states: string[]): Record<string, number> {
  if (!states.length) return {};
  const rows = all<{ state: string; n: number }>(
    `SELECT state, COUNT(*) AS n FROM cases WHERE state IN (${states.map(() => "?").join(", ")}) GROUP BY state`,
    states,
  );
  const out: Record<string, number> = {};
  for (const row of rows) out[row.state] = row.n;
  return out;
}

export function countOpenCases(): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM cases WHERE status = 'open'")?.n ?? 0;
}

export function nextCaseSequence(): number {
  const row = get<{ n: number }>("SELECT COUNT(*) AS n FROM cases");
  return (row?.n ?? 0) + 1;
}

export function createCase(input: {
  id?: string;
  code?: string | null;
  externalId?: string | null;
  source?: string | null;
  title?: string | null;
  serviceKey: string;
  workflowKey: string;
  workflowVersion: number;
  state: string;
  priority?: CaseRow["priority"];
  ownerUserId?: string | null;
  agentUserId?: string | null;
  assignedStaffId?: string | null;
  dueAt?: string | null;
  requiresTracking?: boolean;
  accessLevel?: string | null;
  queue?: string | null;
  meta?: unknown;
}): string {
  const id = input.id ?? newId("case");
  const now = nowIso();
  run(
    `INSERT INTO cases (id, code, external_id, source, title, service_key, workflow_key, workflow_version, state,
       status, priority, owner_user_id, agent_user_id, assigned_staff_id, due_at, requires_tracking, access_level,
       queue, attempts_payment, attempts_tracking, meta, opened_at, created_at, updated_at, last_transition_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
    [
      id,
      input.code ?? null,
      input.externalId ?? null,
      input.source ?? null,
      input.title ?? null,
      input.serviceKey,
      input.workflowKey,
      input.workflowVersion,
      input.state,
      input.priority ?? "normal",
      input.ownerUserId ?? null,
      input.agentUserId ?? null,
      input.assignedStaffId ?? null,
      input.dueAt ?? null,
      input.requiresTracking ? 1 : 0,
      input.accessLevel ?? null,
      input.queue ?? null,
      JSON.stringify(input.meta ?? {}),
      now,
      now,
      now,
      now,
    ],
  );
  return id;
}

export function updateCase(id: string, patch: Record<string, unknown>): void {
  const allowed = [
    "code", "external_id", "source", "title", "service_key", "workflow_key", "workflow_version", "state", "status",
    "outcome", "priority", "owner_user_id", "agent_user_id", "assigned_staff_id", "due_at", "requires_tracking",
    "access_level", "queue", "attempts_payment", "attempts_tracking", "meta", "closed_at", "last_transition_at", "kanban_status",
  ];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => {
    const v = patch[k];
    if (v === undefined || v === null) return null as string | number | null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "object") return JSON.stringify(v);
    return v as string | number;
  });
  run(`UPDATE cases SET ${sets}, updated_at = ? WHERE id = ?`, [...values, nowIso(), id]);
}

/* ── گذارها و تایم‌لاین ──────────────────────────────────────────── */

export interface TransitionRow {
  id: string;
  case_id: string;
  from_state: string;
  to_state: string;
  transition_key: string;
  transition_name: string;
  option: string | null;
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
  reason: string | null;
  payload: string;
  idempotency_key: string | null;
  at: string;
}

export function insertTransition(entry: Omit<TransitionRow, "id">): string {
  const id = newId("tr");
  run(
    `INSERT INTO case_transitions (id, case_id, from_state, to_state, transition_key, transition_name, option,
       actor_type, actor_id, actor_name, reason, payload, idempotency_key, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.case_id,
      entry.from_state,
      entry.to_state,
      entry.transition_key,
      entry.transition_name,
      entry.option,
      entry.actor_type,
      entry.actor_id,
      entry.actor_name,
      entry.reason,
      entry.payload,
      entry.idempotency_key,
      entry.at,
    ],
  );
  return id;
}

export function listTransitions(caseId: string): TransitionRow[] {
  return all<TransitionRow>("SELECT * FROM case_transitions WHERE case_id = ? ORDER BY at ASC", [caseId]);
}

export interface TimelineRow {
  id: string;
  case_id: string;
  kind: string;
  title: string;
  body: string | null;
  visibility: string;
  actor_id: string | null;
  actor_name: string | null;
  at: string;
  meta: string;
}

export function insertTimelineEvent(entry: {
  caseId: string;
  kind: string;
  title: string;
  body?: string | null;
  visibility?: string;
  actorId?: string | null;
  actorName?: string | null;
  at: string;
  meta?: unknown;
}): string {
  const id = newId("evt");
  run(
    `INSERT INTO timeline_events (id, case_id, kind, title, body, visibility, actor_id, actor_name, at, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.caseId,
      entry.kind,
      entry.title,
      entry.body ?? null,
      entry.visibility ?? "internal",
      entry.actorId ?? null,
      entry.actorName ?? null,
      entry.at,
      JSON.stringify(entry.meta ?? {}),
    ],
  );
  return id;
}

export function listTimeline(caseId: string, limit = 200): TimelineRow[] {
  return all<TimelineRow>("SELECT * FROM timeline_events WHERE case_id = ? ORDER BY at DESC LIMIT ?", [caseId, limit]);
}

export function recentTimeline(limit = 10): TimelineRow[] {
  return all<TimelineRow>("SELECT * FROM timeline_events ORDER BY at DESC LIMIT ?", [limit]);
}

/* ── وظایف ───────────────────────────────────────────────────────── */

export interface TaskRow {
  id: string;
  case_id: string | null;
  title: string;
  description: string | null;
  priority: string;
  assignee_id: string | null;
  due_at: string | null;
  status: "open" | "in_progress" | "done" | "cancelled";
  result_note: string | null;
  created_by: string | null;
  dedupe_key: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export function createTask(entry: {
  caseId?: string | null;
  title: string;
  description?: string | null;
  priority?: string;
  assigneeId?: string | null;
  dueAt?: string | null;
  createdBy?: string | null;
  dedupeKey?: string | null;
}): string {
  if (entry.dedupeKey) {
    const existing = get<TaskRow>("SELECT * FROM tasks WHERE dedupe_key = ? AND status IN ('open', 'in_progress')", [entry.dedupeKey]);
    if (existing) return existing.id;
  }
  const id = newId("task");
  const now = nowIso();
  run(
    `INSERT INTO tasks (id, case_id, title, description, priority, assignee_id, due_at, status, created_by, dedupe_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    [
      id,
      entry.caseId ?? null,
      entry.title,
      entry.description ?? null,
      entry.priority ?? "normal",
      entry.assigneeId ?? null,
      entry.dueAt ?? null,
      entry.createdBy ?? null,
      entry.dedupeKey ?? null,
      now,
      now,
    ],
  );
  return id;
}

export function findTaskById(id: string): TaskRow | null {
  return get<TaskRow>("SELECT * FROM tasks WHERE id = ?", [id]);
}

export function updateTask(id: string, patch: Partial<Pick<TaskRow, "status" | "result_note" | "assignee_id" | "priority" | "due_at">>): void {
  const current = findTaskById(id);
  if (!current) return;
  const status = patch.status ?? current.status;
  run(
    `UPDATE tasks SET status = ?, result_note = ?, assignee_id = ?, priority = ?, due_at = ?, updated_at = ?, completed_at = ?
     WHERE id = ?`,
    [
      status,
      patch.result_note === undefined ? current.result_note : patch.result_note,
      patch.assignee_id === undefined ? current.assignee_id : patch.assignee_id,
      patch.priority ?? current.priority,
      patch.due_at === undefined ? current.due_at : patch.due_at,
      nowIso(),
      status === "done" || status === "cancelled" ? nowIso() : null,
      id,
    ],
  );
}

export function listTasks(opts: { assigneeId?: string; status?: string[]; caseId?: string; limit?: number; overdue?: boolean } = {}): TaskRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.assigneeId) {
    clauses.push("assignee_id = ?");
    params.push(opts.assigneeId);
  }
  if (opts.status?.length) {
    clauses.push(`status IN (${opts.status.map(() => "?").join(", ")})`);
    params.push(...opts.status);
  }
  if (opts.caseId) {
    clauses.push("case_id = ?");
    params.push(opts.caseId);
  }
  if (opts.overdue) {
    clauses.push("due_at IS NOT NULL AND due_at < ?");
    params.push(nowIso());
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(opts.limit ?? 100);
  return all<TaskRow>(`SELECT * FROM tasks ${where} ORDER BY COALESCE(due_at, created_at) ASC LIMIT ?`, params);
}

export function countOpenTasks(): { total: number; overdue: number } {
  const total = get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('open','in_progress')")?.n ?? 0;
  const overdue =
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM tasks WHERE status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at < ?",
      [nowIso()],
    )?.n ?? 0;
  return { total, overdue };
}

/* ── مدارک ───────────────────────────────────────────────────────── */

export interface DocumentRow {
  id: string;
  case_id: string;
  kind: string;
  title: string;
  status: "pending" | "submitted" | "incomplete" | "rejected" | "approved";
  note: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  file_name: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export function findDocumentById(id: string): DocumentRow | null {
  return get<DocumentRow>("SELECT * FROM documents WHERE id = ?", [id]);
}

export function listDocuments(caseId: string): DocumentRow[] {
  return all<DocumentRow>("SELECT * FROM documents WHERE case_id = ? ORDER BY created_at ASC", [caseId]);
}

export function upsertDocument(entry: {
  caseId: string;
  kind: string;
  title: string;
  status?: DocumentRow["status"];
  note?: string | null;
  fileName?: string | null;
}): string {
  const existing = get<DocumentRow>("SELECT * FROM documents WHERE case_id = ? AND kind = ?", [entry.caseId, entry.kind]);
  const now = nowIso();
  if (existing) {
    run(
      `UPDATE documents SET title = ?, status = ?, note = ?, file_name = ?, version = version + 1, updated_at = ?
       WHERE id = ?`,
      [entry.title, entry.status ?? existing.status, entry.note ?? existing.note, entry.fileName ?? existing.file_name, now, existing.id],
    );
    return existing.id;
  }
  const id = newId("doc");
  run(
    `INSERT INTO documents (id, case_id, kind, title, status, note, file_name, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, entry.caseId, entry.kind, entry.title, entry.status ?? "submitted", entry.note ?? null, entry.fileName ?? null, now, now],
  );
  return id;
}

export function reviewDocument(id: string, status: DocumentRow["status"], reviewNote: string | null, reviewerId: string): void {
  run("UPDATE documents SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?", [
    status,
    reviewNote,
    reviewerId,
    nowIso(),
    nowIso(),
    id,
  ]);
}

/* ── قرارداد، بررسی حقوقی، امضا، کد رهگیری ─────────────────────── */

export interface ContractRow {
  id: string;
  case_id: string;
  contract_type: "rent" | "sale";
  output_mode: "signature_only" | "signature_and_tracking";
  property_address: string | null;
  city: string | null;
  district: string | null;
  area: number | null;
  landlord_name: string | null;
  tenant_name: string | null;
  seller_name: string | null;
  buyer_name: string | null;
  deposit_amount: number | null;
  rent_amount: number | null;
  sale_price: number | null;
  start_date: string | null;
  end_date: string | null;
  terms_note: string | null;
  clause_version: number;
  document_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export function findContractByCase(caseId: string): ContractRow | null {
  return get<ContractRow>("SELECT * FROM contract_details WHERE case_id = ?", [caseId]);
}

export function upsertContract(caseId: string, input: Partial<Omit<ContractRow, "id" | "case_id">> & { contract_type: "rent" | "sale"; output_mode: "signature_only" | "signature_and_tracking" }): string {
  const existing = findContractByCase(caseId);
  const now = nowIso();
  if (existing) {
    const merged: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) merged[key] = value;
    }
    const keys = Object.keys(merged);
    if (keys.length) {
      const sets = keys.map((k) => `${k} = ?`).join(", ");
      const values = keys.map((k) => {
        const v = merged[k];
        if (v === null) return null as string | number | null;
        return v as string | number;
      });
      run(`UPDATE contract_details SET ${sets}, updated_at = ? WHERE id = ?`, [...values, now, existing.id]);
    }
    return existing.id;
  }
  const id = newId("ctr");
  run(
    `INSERT INTO contract_details (id, case_id, contract_type, output_mode, property_address, city, district, area,
       landlord_name, tenant_name, seller_name, buyer_name, deposit_amount, rent_amount, sale_price, start_date,
       end_date, terms_note, clause_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      caseId,
      input.contract_type,
      input.output_mode,
      input.property_address ?? null,
      input.city ?? null,
      input.district ?? null,
      input.area ?? null,
      input.landlord_name ?? null,
      input.tenant_name ?? null,
      input.seller_name ?? null,
      input.buyer_name ?? null,
      input.deposit_amount ?? null,
      input.rent_amount ?? null,
      input.sale_price ?? null,
      input.start_date ?? null,
      input.end_date ?? null,
      input.terms_note ?? null,
      now,
      now,
    ],
  );
  return id;
}

export function patchContract(caseId: string, patch: Record<string, unknown>): void {
  const allowed = [
    "contract_type", "output_mode", "property_address", "city", "district", "area", "landlord_name", "tenant_name",
    "seller_name", "buyer_name", "deposit_amount", "rent_amount", "sale_price", "start_date", "end_date",
    "terms_note", "clause_version", "document_generated_at",
  ];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => {
    const v = patch[k];
    if (v === undefined || v === null) return null as string | number | null;
    return v as string | number;
  });
  run(`UPDATE contract_details SET ${sets}, updated_at = ? WHERE case_id = ?`, [...values, nowIso(), caseId]);
}

export interface LegalReviewRow {
  id: string;
  case_id: string;
  reviewer_id: string | null;
  result: "approved" | "needs_edit" | "rejected";
  note: string | null;
  clause_version_at_review: number | null;
  at: string;
}

export function insertLegalReview(entry: {
  caseId: string;
  reviewerId?: string | null;
  result: LegalReviewRow["result"];
  note?: string | null;
  clauseVersionAtReview?: number | null;
}): string {
  const id = newId("legal");
  run(
    `INSERT INTO legal_reviews (id, case_id, reviewer_id, result, note, clause_version_at_review, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, entry.caseId, entry.reviewerId ?? null, entry.result, entry.note ?? null, entry.clauseVersionAtReview ?? null, nowIso()],
  );
  return id;
}

export function latestLegalReview(caseId: string): LegalReviewRow | null {
  return get<LegalReviewRow>("SELECT * FROM legal_reviews WHERE case_id = ? ORDER BY at DESC LIMIT 1", [caseId]);
}

export interface SignatureRow {
  id: string;
  case_id: string;
  party: string;
  party_name: string | null;
  status: "pending" | "signed" | "declined";
  method: string | null;
  signed_at: string | null;
  note: string | null;
  created_at: string;
}

export function listSignatures(caseId: string): SignatureRow[] {
  return all<SignatureRow>("SELECT * FROM signatures WHERE case_id = ? ORDER BY created_at ASC", [caseId]);
}

export function upsertSignature(entry: {
  caseId: string;
  party: string;
  partyName?: string | null;
  status?: SignatureRow["status"];
  method?: string | null;
  note?: string | null;
}): string {
  const existing = get<SignatureRow>("SELECT * FROM signatures WHERE case_id = ? AND party = ?", [entry.caseId, entry.party]);
  const now = nowIso();
  if (existing) {
    run("UPDATE signatures SET status = ?, party_name = ?, method = ?, note = ?, signed_at = ? WHERE id = ?", [
      entry.status ?? existing.status,
      entry.partyName ?? existing.party_name,
      entry.method ?? existing.method,
      entry.note ?? existing.note,
      (entry.status ?? existing.status) === "signed" ? now : existing.signed_at,
      existing.id,
    ]);
    return existing.id;
  }
  const id = newId("sig");
  run(
    `INSERT INTO signatures (id, case_id, party, party_name, status, method, signed_at, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.caseId,
      entry.party,
      entry.partyName ?? null,
      entry.status ?? "pending",
      entry.method ?? null,
      (entry.status ?? "pending") === "signed" ? now : null,
      entry.note ?? null,
      now,
    ],
  );
  return id;
}

export interface TrackingRow {
  id: string;
  case_id: string;
  status: "requested" | "in_progress" | "error" | "received";
  code: string | null;
  error: string | null;
  attempts: number;
  requested_at: string | null;
  received_at: string | null;
  updated_at: string;
}

export function findTracking(caseId: string): TrackingRow | null {
  return get<TrackingRow>("SELECT * FROM tracking_requests WHERE case_id = ?", [caseId]);
}

export function upsertTracking(caseId: string, patch: { status: TrackingRow["status"]; code?: string | null; error?: string | null; attempts?: number; incrementAttempts?: boolean }): string {
  const existing = findTracking(caseId);
  const now = nowIso();
  const attempts = patch.attempts ?? (existing?.attempts ?? 0) + (patch.incrementAttempts ? 1 : 0);
  if (existing) {
    run(
      `UPDATE tracking_requests SET status = ?, code = ?, error = ?, attempts = ?, requested_at = ?, received_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        patch.status,
        patch.code === undefined ? existing.code : patch.code,
        patch.error === undefined ? existing.error : patch.error,
        attempts,
        patch.status === "requested" && !existing.requested_at ? now : existing.requested_at,
        patch.status === "received" ? now : existing.received_at,
        now,
        existing.id,
      ],
    );
    return existing.id;
  }
  const id = newId("trk");
  run(
    `INSERT INTO tracking_requests (id, case_id, status, code, error, attempts, requested_at, received_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      caseId,
      patch.status,
      patch.code ?? null,
      patch.error ?? null,
      attempts,
      patch.status === "requested" ? now : null,
      patch.status === "received" ? now : null,
      now,
    ],
  );
  return id;
}

export function jsonCaseMeta(row: CaseRow): Record<string, unknown> {
  return jsonParse<Record<string, unknown>>(row.meta, {});
}
