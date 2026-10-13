/**
 * تست‌های سرویس کانبان ارجاع — پیاده‌سازی فلوچارت ارجاع درون‌سازمانی.
 * سناریو: ارجاع به همکار/واحد، تشخیص واحد، اعتبارسنجی دسترسی، ثبت تاریخچه،
 * اقدام مسئول جدید و ساخت تخته کانبان.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ref-"));
process.env.DATABASE_PATH = path.join(tmpDir, "crm.db");
process.env.MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

type ClientModule = typeof import("@/db/client");
type CasesModule = typeof import("@/db/repos/cases");
type PeopleModule = typeof import("@/db/repos/people");
type ReferralsModule = typeof import("@/db/repos/referrals");
type SvcModule = typeof import("@/domain/service/referral-service");
type Actor = { type: "staff" | "admin"; id: string; name: string };

let client: ClientModule;
let Cases: CasesModule;
let People: PeopleModule;
let Referrals: ReferralsModule;
let Svc: SvcModule;

let recStaff: string;
let legalStaff: string;
let financeStaff: string;
let caseId: string;

beforeAll(async () => {
  client = await import("@/db/client");
  const migrate = await import("@/db/migrate");
  migrate.ensureMigrated();
  Cases = await import("@/db/repos/cases");
  People = await import("@/db/repos/people");
  Referrals = await import("@/db/repos/referrals");
  Svc = await import("@/domain/service/referral-service");

  // واحدها
  for (const [key, name] of [["reception", "پذیرش"], ["legal", "حقوقی"], ["finance", "مالی"]] as const) {
    if (!Referrals.getOrgUnit(key)) Referrals.createOrgUnit({ key, name });
  }

  // کارشناسان با واحد سازمانی
  recStaff = People.createStaff({ username: "rec1", fullName: "پذیرش", role: "staff", passwordHash: "x", orgUnit: "reception" });
  legalStaff = People.createStaff({ username: "legal1", fullName: "حقوقی", role: "staff", passwordHash: "x", orgUnit: "legal" });
  financeStaff = People.createStaff({ username: "fin1", fullName: "مالی", role: "staff", passwordHash: "x", orgUnit: "finance" });

  // پرونده اولیه در واحد پذیرش
  caseId = Cases.createCase({
    serviceKey: "custom",
    workflowKey: "custom_service",
    workflowVersion: 1,
    state: "service_start",
    title: "قرارداد نمونه",
    assignedStaffId: recStaff,
  });
});

afterAll(() => {
  try {
    client.closeDb();
  } catch {
    /* noop */
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ارجاع به واحد (باکس اقدام سریع)", () => {
  it("پرونده را به ستون واحد مقصد منتقل و تاریخچه ثبت می‌کند", () => {
    const res = Svc.referCase({
      caseId,
      actor: { type: "staff", id: recStaff, name: "پذیرش" },
      kind: "unit",
      toUnit: "legal",
      reason: "بررسی حقوقی",
    });

    expect(res.toUnit).toBe("legal");
    expect(res.toStaffId).toBeNull();

    const row = Cases.findCaseById(caseId)!;
    expect(row.kanban_status).toBe("new");
    expect(row.assigned_staff_id).toBeNull();

    const refs = Referrals.listReferralsForCase(caseId);
    expect(refs).toHaveLength(1);
    expect(refs[0].to_unit).toBe("legal");
    expect(refs[0].from_unit).toBe("reception");
    expect(refs[0].reason).toBe("بررسی حقوقی");
  });

  it("واحد جاری کارت را درست تشخیص می‌دهد (ستون کانبان)", () => {
    const board = Svc.buildBoard({ id: legalStaff, role: "staff", unit: "legal", name: "حقوقی" });
    const legalCol = board.columns.find((c) => c.unitKey === "legal");
    expect(legalCol?.cards.some((c) => c.caseId === caseId)).toBe(true);
  });
});

describe("اعتبارسنجی دسترسی", () => {
  it("کارمند خارج از واحد مجاز به اقدام نیست", () => {
    expect(() =>
      Svc.actOnCard({ caseId, actor: { type: "staff", id: recStaff, name: "پذیرش" }, action: "start_review" }),
    ).toThrow(/مسئول/);
  });

  it("مدیر همیشه دسترسی دارد", () => {
    expect(() =>
      Svc.actOnCard({ caseId, actor: { type: "admin", id: "adm", name: "مدیر" }, action: "start_review" }),
    ).not.toThrow();
  });
});

describe("اقدام مسئول جدید (وضعیت کارت)", () => {
  it("شروع رسیدگی وضعیت را in_review می‌کند", () => {
    Svc.actOnCard({ caseId, actor: { type: "staff", id: legalStaff, name: "حقوقی" }, action: "start_review" });
    expect(Cases.findCaseById(caseId)!.kanban_status).toBe("in_review");

    Svc.actOnCard({ caseId, actor: { type: "staff", id: legalStaff, name: "حقوقی" }, action: "need_info" });
    expect(Cases.findCaseById(caseId)!.kanban_status).toBe("waiting_info");

    Svc.actOnCard({ caseId, actor: { type: "staff", id: legalStaff, name: "حقوقی" }, action: "complete" });
    expect(Cases.findCaseById(caseId)!.kanban_status).toBe("done");
  });
});

describe("ارجاع به همکار", () => {
  it("واحد کارمند مقصد را تشخیص می‌دهد و مسئول را به‌روز می‌کند", () => {
    const r = Svc.referCase({
      caseId,
      actor: { type: "staff", id: legalStaff, name: "حقوقی" },
      kind: "colleague",
      toStaffId: financeStaff,
    });
    expect(r.toUnit).toBe("finance");
    expect(r.toStaffId).toBe(financeStaff);
    expect(Cases.findCaseById(caseId)!.assigned_staff_id).toBe(financeStaff);
  });

  it("ارجاع به همکار بدون واحد سازمانی رد می‌شود", () => {
    const noUnit = People.createStaff({ username: "nou", fullName: "بدون واحد", role: "staff", passwordHash: "x" });
    expect(() =>
      Svc.referCase({ caseId, actor: { type: "admin", id: "adm", name: "مدیر" }, kind: "colleague", toStaffId: noUnit }),
    ).toThrow(/واحد سازمانی/);
  });
});

describe("ارجاع مجدد", () => {
  it("مسیر ارجاع‌دهنده → گیرنده را گسترش می‌دهد", () => {
    const before = Referrals.listReferralsForCase(caseId).length;
    Svc.actOnCard({
      caseId,
      actor: { type: "admin", id: "adm", name: "مدیر" },
      action: "rerefer",
      kind: "unit",
      toUnit: "reception",
    });
    const after = Referrals.listReferralsForCase(caseId);
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].to_unit).toBe("reception");
    expect(Cases.findCaseById(caseId)!.kanban_status).toBe("new");
  });
});
