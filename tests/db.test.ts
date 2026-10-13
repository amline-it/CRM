/**
 * تست‌های لایه دیتابیس: مهاجرت، تنظیمات، کاربران، سینک، وب‌هوک، آگهی/نیازمندی.
 * دیتابیس در یک مسیر موقت ساخته می‌شود تا تست‌ها به داده واقعی دست نزنند.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-db-"));
process.env.DATABASE_PATH = path.join(tmpDir, "crm.db");
process.env.MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

type ClientModule = typeof import("@/db/client");
type MigrateModule = typeof import("@/db/migrate");
type PlatformModule = typeof import("@/db/repos/platform");
type PeopleModule = typeof import("@/db/repos/people");
type CatalogModule = typeof import("@/db/repos/catalog");

let client: ClientModule;
let migrate: MigrateModule;
let Platform: PlatformModule;
let People: PeopleModule;
let Catalog: CatalogModule;

beforeAll(async () => {
  client = await import("@/db/client");
  migrate = await import("@/db/migrate");
  Platform = await import("@/db/repos/platform");
  People = await import("@/db/repos/people");
  Catalog = await import("@/db/repos/catalog");
  migrate.ensureMigrated();
});

afterAll(() => {
  client.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("مهاجرت", () => {
  it("همه جداول اصلی ساخته می‌شوند", () => {
    const tables = client
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .map((t) => t.name);
    for (const expected of [
      "schema_migrations",
      "settings",
      "staff",
      "sessions",
      "users",
      "services",
      "cases",
      "case_transitions",
      "timeline_events",
      "tasks",
      "documents",
      "contract_details",
      "legal_reviews",
      "signatures",
      "tracking_requests",
      "invoices",
      "payments",
      "subscriptions",
      "referral_codes",
      "referral_uses",
      "listings",
      "requirements",
      "requirement_matches",
      "notifications",
      "workflow_definitions",
      "sync_log",
      "sync_item_results",
      "outbound_webhooks",
      "pull_cursors",
      "audit_log",
      "idempotency_keys",
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it("مهاجرت دوباره اجرا نمی‌شود (idempotent)", () => {
    const again = migrate.ensureMigrated(true);
    expect(again).toEqual([]);
    expect(migrate.migrationStatus().some((m) => m.version === "0001_init")).toBe(true);
  });
});

describe("تنظیمات و کارکنان", () => {
  it("تنظیمات خوانده و نوشته می‌شوند", () => {
    expect(Platform.getSetting<number>("listing.durationDays", 30)).toBe(30);
    Platform.setSetting("listing.durationDays", 45);
    expect(Platform.getSetting<number>("listing.durationDays", 30)).toBe(45);
    Platform.setSetting("listing.durationDays", 30);
  });

  it("کارمند ساخته می‌شود و ورودش ثبت می‌گردد", () => {
    const id = People.createStaff({
      username: "expert1",
      fullName: "کارشناس یک",
      role: "staff",
      passwordHash: "scrypt$hash",
    });
    expect(People.countAdmins()).toBe(0);
    const adminId = People.createStaff({
      username: "manager1",
      fullName: "مدیر",
      role: "admin",
      passwordHash: "scrypt$hash",
    });
    expect(People.countAdmins()).toBe(1);
    expect(People.findStaffByUsername("expert1")?.id).toBe(id);
    People.touchStaffLogin(id);
    expect(People.findStaffById(id)?.last_login_at).toBeTruthy();
    People.updateStaff(adminId, { active: false });
    expect(People.findStaffById(adminId)?.active).toBe(0);
    People.updateStaff(adminId, { active: true });
  });
});

describe("سینک کاربران", () => {
  it("ایجاد → بدون تغییر → به‌روزرسانی", () => {
    const first = People.upsertUser({
      externalId: "U-100",
      source: "main-server",
      fullName: "علی رضایی",
      mobile: "09120000000",
      payloadHash: "hash-1",
      raw: { id: "U-100" },
    });
    expect(first.action).toBe("created");

    const second = People.upsertUser({
      externalId: "U-100",
      source: "main-server",
      fullName: "علی رضایی",
      mobile: "09120000000",
      payloadHash: "hash-1",
    });
    expect(second.action).toBe("unchanged");
    expect(second.id).toBe(first.id);

    const third = People.upsertUser({
      externalId: "U-100",
      source: "main-server",
      fullName: "علی رضایی‌زاد",
      mobile: "09121111111",
      payloadHash: "hash-2",
    });
    expect(third.action).toBe("updated");
    expect(People.findUserById(first.id)?.full_name).toBe("علی رضایی‌زاد");
    expect(People.countUsers().total).toBe(1);
  });

  it("لاگ سینک و آیتم‌هایش ثبت می‌شوند", () => {
    const logId = Platform.insertSyncLog({
      direction: "in",
      channel: "push",
      entityType: "users",
      source: "main-server",
      itemCount: 1,
      created: 1,
      status: "ok",
    });
    Platform.insertSyncItemResult({ syncLogId: logId, entityType: "user", externalId: "U-100", action: "created" });
    const items = Platform.listSyncItems(logId);
    expect(items).toHaveLength(1);
    expect(items[0].external_id).toBe("U-100");
    expect(Platform.listSyncLog(5)[0].item_count).toBe(1);
  });

  it("کرسور pull ذخیره و بازخوانی می‌شود", () => {
    Platform.setPullCursor("users", "2026-10-13T00:00:00.000Z", "42");
    expect(Platform.getPullCursor("users")).toEqual({
      lastPulledAt: "2026-10-13T00:00:00.000Z",
      lastCursor: "42",
    });
  });
});

describe("کلید یکتایی و وب‌هوک", () => {
  it("پاسخ idempotent ذخیره و بازخوانی می‌شود", () => {
    Platform.saveIdempotentResponse("k-1", "transition", 200, { ok: true });
    expect(Platform.getIdempotentResponse("k-1")?.response).toContain("true");
  });

  it("وب‌هوک در صف قرار می‌گیرد و پس از ۵ تلاش dead می‌شود", () => {
    const id = Platform.enqueueWebhook("case.completed", { caseId: "c1" }, "https://example.com/hook", "c1");
    const due = Platform.dueWebhooks(10);
    expect(due.some((w) => w.id === id)).toBe(true);
    Platform.markWebhook(id, { ok: false, error: "timeout", attempts: 1 });
    expect(Platform.listWebhooks(5).find((w) => w.id === id)?.status).toBe("failed");
    Platform.markWebhook(id, { ok: false, error: "timeout", attempts: 5 });
    expect(Platform.listWebhooks(5).find((w) => w.id === id)?.status).toBe("dead");
  });

  it("حسابرسی نوشته می‌شود", () => {
    Platform.writeAudit({ actorType: "staff", actorName: "کارشناس", action: "test.action", entityType: "case", entityId: "c1" });
    expect(Platform.listAudit(5)[0].action).toBe("test.action");
  });
});

describe("کاتالوگ، آگهی و تطبیق", () => {
  it("خدمت upsert می‌شود (بدون تکرار)", () => {
    const id1 = Catalog.upsertService({
      key: "contract",
      name: "تنظیم قرارداد",
      category: "contract",
      price: 500000,
      workflowKey: "contract",
      requiredDocuments: ["ownership", "national_id"],
    });
    const id2 = Catalog.upsertService({
      key: "contract",
      name: "تنظیم قرارداد املاک",
      category: "contract",
      price: 600000,
      workflowKey: "contract",
      requiredDocuments: ["ownership", "national_id"],
    });
    expect(id2).toBe(id1);
    expect(Catalog.listServices().filter((s) => s.key === "contract")).toHaveLength(1);
    expect(Catalog.serviceRequiredDocuments("contract")).toEqual(["ownership", "national_id"]);
  });

  it("تطبیق نیازمندی با آگهی‌ها امتیازدهی می‌شود", () => {
    const listingId = Catalog.createListing({
      deal_type: "rent",
      property_type: "آپارتمان",
      city: "تهران",
      district: "سعادت‌آباد",
      area: 90,
      rooms: 2,
      deposit: 200_000_000,
      rent: 15_000_000,
      status: "published",
      images: JSON.stringify(["https://example.com/1.jpg"]),
    });
    const requirementId = Catalog.createRequirement({
      deal_type: "rent",
      property_type: "آپارتمان",
      city: "تهران",
      districts: ["سعادت‌آباد"],
      budget_max: 20_000_000,
      area_min: 80,
      rooms: 2,
      access_level: "public",
      status: "open",
    });
    const requirement = Catalog.findRequirementById(requirementId)!;
    const matches = Catalog.computeMatches(requirement);
    expect(matches.length).toBe(1);
    expect(matches[0].listingId).toBe(listingId);
    expect(matches[0].score).toBeGreaterThan(0.45);
    expect(matches[0].note).toContain("محله");
    expect(matches[0].note).toContain("شهر");

    Catalog.replaceMatches(requirementId, matches);
    expect(Catalog.listMatches(requirementId)).toHaveLength(1);
    Catalog.replaceMatches(requirementId, []);
    expect(Catalog.listMatches(requirementId)).toHaveLength(0);
  });
});
