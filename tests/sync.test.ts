/**
 * تست‌های سینک: اعتبارسنجی امضا/کلید، اینگست چهار موجودیت، رفتار با آیتم خراب، وب‌هوک.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-sync-"));
process.env.DATABASE_PATH = path.join(tmpDir, "crm.db");
process.env.MIGRATIONS_DIR = path.join(process.cwd(), "migrations");
process.env.SYNC_API_KEY = "test-sync-key";
process.env.SYNC_SECRET = "test-sync-secret";

type ClientModule = typeof import("@/db/client");
type CasesModule = typeof import("@/db/repos/cases");
type CatalogModule = typeof import("@/db/repos/catalog");
type PeopleModule = typeof import("@/db/repos/people");
type PlatformModule = typeof import("@/db/repos/platform");
type SyncModule = typeof import("@/services/sync");

let client: ClientModule;
let Cases: CasesModule;
let Catalog: CatalogModule;
let People: PeopleModule;
let Platform: PlatformModule;
let Sync: SyncModule;

function signed(body: string): { apiKey: string; signature: string } {
  return {
    apiKey: "test-sync-key",
    signature: `sha256=${createHmac("sha256", "test-sync-secret").update(body, "utf8").digest("hex")}`,
  };
}

beforeAll(async () => {
  client = await import("@/db/client");
  const migrate = await import("@/db/migrate");
  migrate.ensureMigrated();
  Cases = await import("@/db/repos/cases");
  Catalog = await import("@/db/repos/catalog");
  People = await import("@/db/repos/people");
  Platform = await import("@/db/repos/platform");
  Sync = await import("@/services/sync");
});

afterAll(() => {
  client.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("احراز هویت سینک", () => {
  it("کلید یا امضای نادرست رد می‌شود", () => {
    const body = JSON.stringify({ items: [] });
    expect(Sync.checkIngestAuth({ apiKey: "wrong", signature: signed(body).signature }, body).ok).toBe(false);
    expect(Sync.checkIngestAuth({ apiKey: "test-sync-key", signature: "sha256=deadbeef" }, body).ok).toBe(false);
    expect(Sync.checkIngestAuth({ apiKey: "test-sync-key", signature: null }, body).ok).toBe(false);
    expect(Sync.checkIngestAuth(signed(body), body).ok).toBe(true);
  });

  it("امضا نسبت به بدنه حساس است", () => {
    const sig = signed("{}").signature;
    expect(Sync.verifySignature('{"a":1}', sig)).toBe(false);
    expect(Sync.verifySignature("{}", sig)).toBe(true);
  });

  it("بدنه نامعتبر خطای ساخت‌یافته می‌دهد", () => {
    expect(() => Sync.parseBody("not-json")).toThrowError(/JSON/);
  });
});

describe("اینگست کاربران", () => {
  it("ایجاد → بدون تغییر → به‌روزرسانی", () => {
    const first = Sync.ingest("users", { source: "main-server", items: [
      { externalId: "U-1", fullName: "علی رضایی", mobile: "09120000000", hash: "h1" },
    ] }, { idempotencyKey: "k1" });
    expect(first.summary.created).toBe(1);
    expect(first.items[0].action).toBe("created");

    const second = Sync.ingest("users", { source: "main-server", items: [
      { externalId: "U-1", fullName: "علی رضایی", mobile: "09120000000", hash: "h1" },
    ] }, {});
    expect(second.items[0].action).toBe("unchanged");

    const third = Sync.ingest("users", { source: "main-server", items: [
      { externalId: "U-1", fullName: "علی رضایی‌زاد", mobile: "09121111111", hash: "h2" },
    ] }, {});
    expect(third.items[0].action).toBe("updated");
    expect(People.findUserByExternal("main-server", "U-1")?.full_name).toBe("علی رضایی‌زاد");
  });

  it("آیتم خراب کل باچ را رد نمی‌کند و در لاگ می‌نشیند", () => {
    const result = Sync.ingest("users", { source: "main-server", items: [
      { externalId: "U-2", fullName: "کاربر سالم" },
      { fullName: "بدون شناسه" },
      "رشته نامعتبر",
    ] }, { idempotencyKey: "k2" });
    expect(result.summary.created).toBe(1);
    expect(result.summary.rejected).toBe(2);
    const log = Platform.listSyncLog(5).find((l) => l.id === result.syncLogId)!;
    expect(log.status).toBe("partial");
    expect(log.rejected).toBe(2);
    const items = Platform.listSyncItems(result.syncLogId!);
    expect(items.filter((i) => i.action === "rejected")).toHaveLength(2);
  });
});

describe("اینگست قرارداد، آگهی و نیازمندی", () => {
  it("قرارداد سینک‌شده پرونده و جزئیات می‌سازد", () => {
    const user = People.findUserByExternal("main-server", "U-1")!;
    const result = Sync.ingest("contracts", {
      source: "main-server",
      items: [
        {
          externalId: "C-100",
          contractType: "rent",
          address: "تهران، سعادت‌آباد",
          city: "تهران",
          district: "سعادت‌آباد",
          area: 88,
          landlordName: "حسن محمدی",
          tenantName: "علی رضایی",
          rent: 15_000_000,
          deposit: 200_000_000,
          ownerExternalId: "U-1",
          trackingCode: "1405987654321",
          documents: [{ kind: "ownership", status: "approved" }],
        },
      ],
    }, {});
    expect(result.summary.created).toBe(1);
    const caseRow = Cases.findCaseByExternal("main-server", "C-100")!;
    expect(caseRow).toBeTruthy();
    expect(caseRow.owner_user_id).toBe(user.id);
    const contract = Cases.findContractByCase(caseRow.id)!;
    expect(contract.contract_type).toBe("rent");
    expect(contract.rent_amount).toBe(15_000_000);
    expect(contract.landlord_name).toBe("حسن محمدی");
    expect(Cases.findTracking(caseRow.id)?.code).toBe("1405987654321");
    expect(Cases.listDocuments(caseRow.id).some((d) => d.kind === "ownership" && d.status === "approved")).toBe(true);

    const again = Sync.ingest("contracts", { source: "main-server", items: [
      {
        externalId: "C-100",
        contractType: "rent",
        address: "تهران، سعادت‌آباد",
        city: "تهران",
        district: "سعادت‌آباد",
        area: 88,
        landlordName: "حسن محمدی",
        tenantName: "علی رضایی",
        rent: 15_000_000,
        deposit: 200_000_000,
      },
    ] }, {});
    expect(again.items[0].action).toBe("unchanged");
  });

  it("آگهی سینک‌شده با وضعیت منبع ثبت می‌شود", () => {
    const result = Sync.ingest("listings", { source: "main-server", items: [
      {
        externalId: "L-9",
        dealType: "rent",
        propertyType: "آپارتمان",
        city: "تهران",
        district: "ونک",
        area: 95,
        rent: 25_000_000,
        deposit: 300_000_000,
        images: ["https://example.com/a.jpg"],
        status: "published",
      },
    ] }, {});
    expect(result.summary.created).toBe(1);
    const listing = Catalog.findListingByExternal("main-server", "L-9")!;
    expect(listing.status).toBe("published");
    expect(listing.rent).toBe(25_000_000);
    expect(JSON.parse(listing.images)).toEqual(["https://example.com/a.jpg"]);
  });

  it("نیازمندی سینک‌شده با ناحیه‌ها و سطح دسترسی ثبت می‌شود", () => {
    const result = Sync.ingest("requirements", { source: "main-server", items: [
      {
        externalId: "R-7",
        dealType: "rent",
        city: "تهران",
        districts: ["سعادت‌آباد", "ولنجک"],
        budgetMax: 30_000_000,
        areaMin: 85,
        accessLevel: "agents",
      },
    ] }, {});
    expect(result.summary.created).toBe(1);
    const requirement = Catalog.findRequirementByExternal("main-server", "R-7")!;
    expect(requirement.access_level).toBe("agents");
    expect(JSON.parse(requirement.districts)).toEqual(["سعادت‌آباد", "ولنجک"]);
  });

  it("حذف نرم از منبع، پرونده را می‌بندد", () => {
    Sync.ingest("contracts", { source: "main-server", items: [
      {
        externalId: "C-100",
        contractType: "rent",
        address: "تهران، سعادت‌آباد",
        city: "تهران",
        district: "سعادت‌آباد",
        area: 88,
        landlordName: "حسن محمدی",
        tenantName: "علی رضایی",
        rent: 15_000_000,
        deposit: 200_000_000,
        deleted: true,
      },
    ] }, {});
    const caseRow = Cases.findCaseByExternal("main-server", "C-100")!;
    expect(caseRow.status).toBe("closed");
    expect(caseRow.outcome).toBe("deleted");
  });
});

describe("وب‌هوک خروجی", () => {
  it("امضای وب‌هوک قابل بازتولید است", () => {
    const raw = JSON.stringify({ event: "case.completed", data: { caseId: "c1" } });
    const sig = Sync.signOutboundPayload(raw);
    const expected = `sha256=${createHmac("sha256", "test-sync-secret").update(raw, "utf8").digest("hex")}`;
    expect(sig).toBe(expected);
  });

  it("بدون آدرس هدف، تلاش ناموفق ثبت می‌شود و شمارش بالا می‌رود", async () => {
    const id = Platform.enqueueWebhook("case.completed", { caseId: "c1" }, null, "c1");
    const results = await Sync.dispatchDueWebhooks(5);
    const mine = results.find((r) => r.id === id)!;
    expect(mine.ok).toBe(false);
    expect(mine.attempts).toBe(1);
  });

  it("وضعیت کلی سینک برای پنل مدیر آماده است", () => {
    const overview = Sync.syncOverview();
    expect(overview.logs.length).toBeGreaterThan(0);
    expect(overview.cursors.users).toBeDefined();
    expect(overview.pullEnabled).toBe(false);
  });
});
