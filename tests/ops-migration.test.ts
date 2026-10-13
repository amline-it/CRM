/**
 * آزمون مهاجرت روی داده موجود: پایگاه‌داده‌ای که فقط 0001 و 0002 را دیده و
 * داده واقعی دارد، باید با اجرای 0003 بدون کاهش داده و بدون نقض کلید خارجی
 * ارتقا پیدا کند. (اجرای مکرر هم باید بی‌اثر/idempotent باشد.)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-mig-"));
const realMigrations = path.join(process.cwd(), "migrations");
const legacyMigrations = path.join(tmpDir, "migrations-legacy");
fs.mkdirSync(legacyMigrations, { recursive: true });

// تنها مهاجرت‌های قدیمی را در دسترسِ اجراکننده می‌گذاریم تا وضعیت پیش از 0003 بازسازی شود
for (const file of ["0001_init.sql", "0002_referral_kanban.sql"]) {
  fs.copyFileSync(path.join(realMigrations, file), path.join(legacyMigrations, file));
}

process.env.DATABASE_PATH = path.join(tmpDir, "crm.db");
process.env.MIGRATIONS_DIR = legacyMigrations;

type ClientModule = typeof import("@/db/client");
type MigrateModule = typeof import("@/db/migrate");

let client: ClientModule;
let migrate: MigrateModule;

const NOW = "2026-10-01T08:00:00.000Z";

beforeAll(async () => {
  client = await import("@/db/client");
  migrate = await import("@/db/migrate");

  // ۱) پایگاه‌داده «قدیمی» با دو مهاجرت اول
  const first = migrate.ensureMigrated();
  expect(first).toEqual(["0001_init", "0002_referral_kanban"]);

  // ۲) داده واقعی موجود در نسخه قبلی
  client.run(
    `INSERT INTO staff (id, username, password_hash, full_name, role, active, sso_subject, org_unit, title, created_at, updated_at)
     VALUES ('staff-1', 'legacy1', 'hash', 'کارمند قدیمی', 'staff', 1, NULL, 'legal', 'کارشناس', ?, ?),
            ('staff-2', 'legacy2', 'hash', 'مدیر قدیمی', 'admin', 1, NULL, NULL, NULL, ?, ?)`,
    [NOW, NOW, NOW, NOW],
  );
  client.run(
    `INSERT INTO sessions (id, staff_id, token_hash, user_agent, ip, created_at, expires_at, revoked_at)
     VALUES ('ses-1', 'staff-1', 'th-1', 'ua', '127.0.0.1', ?, ?, NULL)`,
    [NOW, "2026-12-01T00:00:00.000Z"],
  );
  client.run(
    `INSERT INTO cases (id, code, service_key, workflow_key, workflow_version, state, status, priority,
       assigned_staff_id, kanban_status, due_at, meta, opened_at, created_at, updated_at)
     VALUES ('case-1', 'C-1001', 'contract', 'contract', 1, 'contract_start', 'open', 'high',
             'staff-1', 'in_review', ?, '{"tag":"legacy"}', ?, ?, ?),
            ('case-2', 'C-1002', 'listing', 'listing', 1, 'listing_start', 'closed', 'normal',
             'staff-1', 'new', NULL, '{}', ?, ?, ?)`,
    [NOW, NOW, NOW, NOW, NOW, NOW, NOW],
  );
  client.run(
    `INSERT INTO referrals (id, case_id, from_staff_id, from_unit, to_staff_id, to_unit, kind, reason, service_key, service_name, depth, at, created_at)
     VALUES ('ref-legacy', 'case-1', 'staff-1', 'legal', NULL, 'finance', 'unit', 'بررسی مالی', 'contract', 'قرارداد', 1, ?, ?)`,
    [NOW, NOW],
  );
  client.run(
    `INSERT INTO timeline_events (id, case_id, kind, title, body, visibility, actor_id, actor_name, at, meta)
     VALUES ('evt-legacy', 'case-1', 'note', 'یادداشت قدیمی', 'متن', 'internal', 'staff-1', 'کارمند قدیمی', ?, '{}')`,
    [NOW],
  );
  client.run(
    `INSERT INTO case_transitions (id, case_id, from_state, to_state, transition_key, transition_name, actor_type, actor_id, actor_name, at)
     VALUES ('tr-1', 'case-1', 'contract_start', 'contract_review', 'submit', 'ارسال به بررسی', 'staff', 'staff-1', 'کارمند قدیمی', ?)`,
    [NOW],
  );

  // ۳) مهاجرت روی همان داده
  process.env.MIGRATIONS_DIR = realMigrations;
  const second = migrate.ensureMigrated(true);
  expect(second).toEqual(["0003_ops_conversations"]);
});

afterAll(() => {
  try {
    client.closeDb();
  } catch {
    /* noop */
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("مهاجرت 0003 روی داده موجود", () => {
  it("هیچ داده‌ای از دست نرفته و مقادیر قدیمی دست‌نخورده‌اند", () => {
    const caseRow = client.get<{ code: string; kanban_status: string; state: string; meta: string; priority: string }>(
      "SELECT code, kanban_status, state, meta, priority FROM cases WHERE id = 'case-1'",
    )!;
    expect(caseRow.code).toBe("C-1001");
    expect(caseRow.kanban_status).toBe("in_review");
    expect(caseRow.state).toBe("contract_start");
    expect(caseRow.priority).toBe("high");
    expect(caseRow.meta).toContain("legacy");

    const closed = client.get<{ status: string }>("SELECT status FROM cases WHERE id = 'case-2'")!;
    expect(closed.status).toBe("closed");

    const ref = client.get<{ reason: string; to_unit: string; depth: number; note: string | null; status_after: string | null }>(
      "SELECT reason, to_unit, depth, note, status_after FROM referrals WHERE id = 'ref-legacy'",
    )!;
    expect(ref.reason).toBe("بررسی مالی");
    expect(ref.to_unit).toBe("finance");
    expect(ref.depth).toBe(1);
    expect(ref.note).toBeNull(); // ستون تازه، بدون مقدار برای داده قدیمی
    expect(ref.status_after).toBeNull();

    expect(client.get<{ n: number }>("SELECT COUNT(*) AS n FROM timeline_events")!.n).toBe(1);
    expect(client.get<{ n: number }>("SELECT COUNT(*) AS n FROM case_transitions")!.n).toBe(1);
    expect(client.get<{ n: number }>("SELECT COUNT(*) AS n FROM staff")!.n).toBe(2);
    expect(client.get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions")!.n).toBe(1);
  });

  it("کلیدهای خارجی و یکپارچگی پایگاه‌داده سالم است (بازنویسی جدول cases باعث شکست FK نشده)", () => {
    expect(client.all<Record<string, unknown>>("PRAGMA foreign_key_check")).toHaveLength(0);
    const integrity = client.get<{ integrity_check: string }>("PRAGMA integrity_check")!;
    expect(integrity.integrity_check).toBe("ok");
    // حذف پرونده باید رکوردهای فرزند را هم پاک کند → یعنی FK روی جدول بازنویسی‌شده فعال است
    client.run("DELETE FROM cases WHERE id = 'case-1'");
    expect(client.get<{ n: number }>("SELECT COUNT(*) AS n FROM referrals WHERE case_id = 'case-1'")!.n).toBe(0);
    expect(client.get<{ n: number }>("SELECT COUNT(*) AS n FROM timeline_events WHERE case_id = 'case-1'")!.n).toBe(0);
    expect(client.get<{ n: number }>("SELECT COUNT(*) AS n FROM case_transitions WHERE case_id = 'case-1'")!.n).toBe(0);
  });

  it("وضعیت جدید «لغو‌شده» پذیرفته می‌شود و مقدار نامعتبر همچنان رد می‌شود", () => {
    client.run("UPDATE cases SET kanban_status = 'cancelled' WHERE id = 'case-2'");
    expect(client.get<{ kanban_status: string }>("SELECT kanban_status FROM cases WHERE id = 'case-2'")!.kanban_status).toBe(
      "cancelled",
    );
    expect(() => client.run("UPDATE cases SET kanban_status = 'bogus' WHERE id = 'case-2'")).toThrow();
  });

  it("جدول‌ها و ایندکس‌های تازه ساخته شده‌اند و اجرای دوباره مهاجرت بی‌اثر است", () => {
    const tables = client
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((r) => r.name);
    for (const table of ["case_messages", "case_message_mentions", "case_conversation_reads"]) {
      expect(tables).toContain(table);
    }
    const indexes = client
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")
      .map((r) => r.name);
    for (const index of ["idx_cases_kanban", "idx_cases_due", "idx_referrals_idem", "idx_notifications_dedupe", "idx_case_messages_case"]) {
      expect(indexes).toContain(index);
    }
    const notificationsColumns = client
      .all<{ name: string }>("PRAGMA table_info(notifications)")
      .map((r) => r.name);
    for (const column of ["to_staff_id", "kind", "link", "read_at", "dedupe_key"]) {
      expect(notificationsColumns).toContain(column);
    }
    expect(migrate.ensureMigrated(true)).toEqual([]);
  });
});
