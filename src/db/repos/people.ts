/**
 * ریپازیتوری افراد: کارمندان پنل، جلسه‌ها، کاربران سینک‌شده.
 */
import { all, get, nowIso, run } from "@/db/client";
import { newId } from "@/lib/ids";

/* ── کارمندان ────────────────────────────────────────────────────── */

export interface StaffRow {
  id: string;
  username: string;
  password_hash: string | null;
  full_name: string;
  role: "staff" | "admin";
  active: number;
  sso_subject: string | null;
  org_unit: string | null;
  title: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export function findStaffByUsername(username: string): StaffRow | null {
  return get<StaffRow>("SELECT * FROM staff WHERE username = ?", [username]);
}

export function findStaffById(id: string): StaffRow | null {
  return get<StaffRow>("SELECT * FROM staff WHERE id = ?", [id]);
}

export function findStaffBySsoSubject(subject: string): StaffRow | null {
  return get<StaffRow>("SELECT * FROM staff WHERE sso_subject = ?", [subject]);
}

export function listStaff(): StaffRow[] {
  return all<StaffRow>("SELECT * FROM staff ORDER BY role DESC, full_name");
}

export function listActiveStaff(): StaffRow[] {
  return all<StaffRow>("SELECT * FROM staff WHERE active = 1 ORDER BY full_name");
}

export function createStaff(input: {
  username: string;
  passwordHash: string | null;
  fullName: string;
  role: "staff" | "admin";
  ssoSubject?: string | null;
  orgUnit?: string | null;
  title?: string | null;
}): string {
  const id = newId("staff");
  const now = nowIso();
  run(
    `INSERT INTO staff (id, username, password_hash, full_name, role, active, sso_subject, org_unit, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    [
      id,
      input.username,
      input.passwordHash,
      input.fullName,
      input.role,
      input.ssoSubject ?? null,
      input.orgUnit ?? null,
      input.title ?? null,
      now,
      now,
    ],
  );
  return id;
}

export function updateStaff(
  id: string,
  patch: {
    fullName?: string;
    role?: "staff" | "admin";
    active?: boolean;
    passwordHash?: string | null;
    orgUnit?: string | null;
    title?: string | null;
  },
): void {
  const current = findStaffById(id);
  if (!current) return;
  run(
    `UPDATE staff SET full_name = ?, role = ?, active = ?, password_hash = ?, org_unit = ?, title = ?, updated_at = ? WHERE id = ?`,
    [
      patch.fullName ?? current.full_name,
      patch.role ?? current.role,
      patch.active === undefined ? current.active : patch.active ? 1 : 0,
      patch.passwordHash === undefined ? current.password_hash : patch.passwordHash,
      patch.orgUnit === undefined ? current.org_unit : patch.orgUnit ?? null,
      patch.title === undefined ? current.title : patch.title ?? null,
      nowIso(),
      id,
    ],
  );
}

export function touchStaffLogin(id: string): void {
  run("UPDATE staff SET last_login_at = ? WHERE id = ?", [nowIso(), id]);
}

export function countAdmins(): number {
  const row = get<{ n: number }>("SELECT COUNT(*) AS n FROM staff WHERE role = 'admin' AND active = 1");
  return row?.n ?? 0;
}

/* ── جلسه‌ها ─────────────────────────────────────────────────────── */

export interface SessionRow {
  id: string;
  staff_id: string;
  token_hash: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export function createSession(entry: { staffId: string; tokenHash: string; expiresAt: string; userAgent?: string | null; ip?: string | null }): string {
  const id = newId("sess");
  run(
    `INSERT INTO sessions (id, staff_id, token_hash, user_agent, ip, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, entry.staffId, entry.tokenHash, entry.userAgent ?? null, entry.ip ?? null, nowIso(), entry.expiresAt],
  );
  return id;
}

export function findSessionByTokenHash(tokenHash: string): SessionRow | null {
  return get<SessionRow>("SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL", [tokenHash]);
}

export function revokeSession(tokenHash: string): void {
  run("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?", [nowIso(), tokenHash]);
}

export function revokeStaffSessions(staffId: string): void {
  run("UPDATE sessions SET revoked_at = ? WHERE staff_id = ? AND revoked_at IS NULL", [nowIso(), staffId]);
}

/* ── کاربران سینک‌شده ────────────────────────────────────────────── */

export interface UserRow {
  id: string;
  external_id: string | null;
  source: string | null;
  full_name: string;
  national_id: string | null;
  mobile: string | null;
  email: string | null;
  user_type: "normal" | "agent";
  agent_license_no: string | null;
  city: string | null;
  status: string;
  deleted: number;
  payload_hash: string | null;
  raw: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export function findUserById(id: string): UserRow | null {
  return get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
}

export function findUserByExternal(source: string, externalId: string): UserRow | null {
  return get<UserRow>("SELECT * FROM users WHERE source = ? AND external_id = ?", [source, externalId]);
}

export function listUsers(opts: { includeDeleted?: boolean; type?: "normal" | "agent"; search?: string; limit?: number; offset?: number } = {}): UserRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (!opts.includeDeleted) clauses.push("deleted = 0");
  if (opts.type) {
    clauses.push("user_type = ?");
    params.push(opts.type);
  }
  if (opts.search) {
    clauses.push("(full_name LIKE ? OR mobile LIKE ? OR national_id LIKE ?)");
    const like = `%${opts.search}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(opts.limit ?? 100, opts.offset ?? 0);
  return all<UserRow>(`SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, params);
}

export function countUsers(): { total: number; agents: number; normal: number } {
  const total = get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE deleted = 0")?.n ?? 0;
  const agents = get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE deleted = 0 AND user_type = 'agent'")?.n ?? 0;
  return { total, agents, normal: total - agents };
}

export function upsertUser(input: {
  externalId: string;
  source: string;
  fullName: string;
  nationalId?: string | null;
  mobile?: string | null;
  email?: string | null;
  userType?: "normal" | "agent";
  agentLicenseNo?: string | null;
  city?: string | null;
  status?: string;
  payloadHash?: string | null;
  raw?: unknown;
  deleted?: boolean;
}): { id: string; action: "created" | "updated" | "unchanged" } {
  const existing = findUserByExternal(input.source, input.externalId);
  const now = nowIso();
  const rawJson = input.raw === undefined ? null : JSON.stringify(input.raw);
  if (existing) {
    if (input.payloadHash && existing.payload_hash === input.payloadHash) {
      run("UPDATE users SET synced_at = ? WHERE id = ?", [now, existing.id]);
      return { id: existing.id, action: "unchanged" };
    }
    run(
      `UPDATE users SET full_name = ?, national_id = ?, mobile = ?, email = ?, user_type = ?, agent_license_no = ?,
        city = ?, status = ?, deleted = ?, payload_hash = ?, raw = ?, synced_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.fullName,
        input.nationalId ?? existing.national_id,
        input.mobile ?? existing.mobile,
        input.email ?? existing.email,
        input.userType ?? existing.user_type,
        input.agentLicenseNo ?? existing.agent_license_no,
        input.city ?? existing.city,
        input.status ?? existing.status,
        input.deleted ? 1 : 0,
        input.payloadHash ?? existing.payload_hash,
        rawJson ?? existing.raw,
        now,
        now,
        existing.id,
      ],
    );
    return { id: existing.id, action: "updated" };
  }
  const id = newId("usr");
  run(
    `INSERT INTO users (id, external_id, source, full_name, national_id, mobile, email, user_type, agent_license_no,
       city, status, deleted, payload_hash, raw, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.externalId,
      input.source,
      input.fullName,
      input.nationalId ?? null,
      input.mobile ?? null,
      input.email ?? null,
      input.userType ?? "normal",
      input.agentLicenseNo ?? null,
      input.city ?? null,
      input.status ?? "active",
      input.deleted ? 1 : 0,
      input.payloadHash ?? null,
      rawJson,
      now,
      now,
      now,
    ],
  );
  return { id, action: "created" };
}
