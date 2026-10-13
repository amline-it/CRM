/**
 * تست‌های سرتاسری لایه سرویس: پرونده واقعی در SQLite + موتور گردش‌کار.
 * هر تست یک جریان کامل فلوچارت را از ابتدا تا انتها می‌راند.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { ActorContext } from "@/domain/engine/types";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-svc-"));
process.env.DATABASE_PATH = path.join(tmpDir, "crm.db");
process.env.MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

type ClientModule = typeof import("@/db/client");
type CasesModule = typeof import("@/db/repos/cases");
type CatalogModule = typeof import("@/db/repos/catalog");
type FinanceModule = typeof import("@/db/repos/finance");
type PlatformModule = typeof import("@/db/repos/platform");
type PeopleModule = typeof import("@/db/repos/people");
type SvcModule = typeof import("@/domain/service/case-service");

let client: ClientModule;
let Cases: CasesModule;
let Catalog: CatalogModule;
let Finance: FinanceModule;
let Platform: PlatformModule;
let People: PeopleModule;
let Svc: SvcModule;

const staff: ActorContext = { type: "staff", id: "stf-1", name: "کارشناس فروش" };
const admin: ActorContext = { type: "admin", id: "adm-1", name: "مدیر" };

function stateOf(caseId: string): string {
  return Cases.findCaseById(caseId)!.state;
}

function approveAllDocuments(caseId: string, actor: ActorContext): void {
  for (const doc of Cases.listDocuments(caseId)) {
    if (doc.status !== "approved") Svc.reviewDocumentAction({ documentId: doc.id, status: "approved", actor });
  }
}

beforeAll(async () => {
  client = await import("@/db/client");
  const migrate = await import("@/db/migrate");
  migrate.ensureMigrated();
  Cases = await import("@/db/repos/cases");
  Catalog = await import("@/db/repos/catalog");
  Finance = await import("@/db/repos/finance");
  Platform = await import("@/db/repos/platform");
  People = await import("@/db/repos/people");
  Svc = await import("@/domain/service/case-service");

  Catalog.upsertService({
    key: "contract",
    name: "تنظیم قرارداد",
    category: "contract",
    price: 500_000,
    workflowKey: "contract",
    requiredDocuments: ["ownership", "national_id"],
    sortOrder: 1,
  });
  Catalog.upsertService({
    key: "listing",
    name: "ثبت آگهی",
    category: "listing",
    price: 200_000,
    workflowKey: "listing",
    sortOrder: 2,
  });
  Catalog.upsertService({
    key: "requirements",
    name: "درخواست نیازمندی",
    category: "requirements",
    price: 0,
    workflowKey: "requirements",
    sortOrder: 3,
  });
  Catalog.upsertService({
    key: "custom_service",
    name: "خدمت سفارشی",
    category: "custom",
    price: 300_000,
    workflowKey: "custom_service",
    sortOrder: 4,
  });
});

afterAll(() => {
  client.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("پرونده قرارداد اجاره (فقط امضا)", () => {
  let caseId = "";
  let userId = "";

  it("پرونده ساخته می‌شود؛ شماره پرونده، مدارک لازم و پوسته قرارداد ثبت می‌شود", () => {
    const user = People.upsertUser({
      externalId: "U-1",
      source: "main-server",
      fullName: "علی رضایی",
      mobile: "09120000001",
      payloadHash: "u1",
    });
    userId = user.id;
    const created = Svc.createCase({ serviceKey: "contract", ownerUserId: userId, title: "اجاره سعادت‌آباد" });
    caseId = created.caseId;
    const row = Cases.findCaseById(caseId)!;
    expect(row.state).toBe("contract_start");
    expect(row.code).toBeTruthy();
    expect(Cases.listDocuments(caseId).map((d) => d.kind).sort()).toEqual(["national_id", "ownership"]);
    expect(Cases.findContractByCase(caseId)?.contract_type).toBe("rent");
  });

  it("انتخاب نوع قرارداد و ثبت اطلاعات اجاره", () => {
    const choice = Svc.applyTransition({ caseId, transitionKey: "choose_contract_type", option: "rent", actor: staff });
    expect(choice.to).toBe("rent_info");

    Svc.saveContractDetails(
      caseId,
      {
        contractType: "rent",
        outputMode: "signature_only",
        propertyAddress: "تهران، سعادت‌آباد، خیابان ۲۳",
        city: "تهران",
        district: "سعادت‌آباد",
        area: 85,
        landlordName: "حسن محمدی",
        tenantName: "علی رضایی",
        depositAmount: 200_000_000,
        rentAmount: 15_000_000,
        startDate: "1405/07/21",
        endDate: "1406/07/20",
      },
      staff,
    );

    const submitted = Svc.applyTransition({ caseId, transitionKey: "rent_info_submitted", actor: staff });
    expect(submitted.to).toBe("output_choice");
  });

  it("انتخاب «فقط امضا» به بررسی مالی می‌رسد و فاکتور صادر می‌شود", () => {
    const applied = Svc.applyTransition({ caseId, transitionKey: "choose_output", option: "signature_only", actor: staff });
    expect(applied.to).toBe("finance_check");
    expect(Cases.findCaseById(caseId)?.requires_tracking).toBe(0);
    const invoices = Finance.listInvoices(caseId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].amount).toBe(500_000);
    expect(invoices[0].status).toBe("unpaid");
  });

  it("پرداخت مستقیم پرونده را تا بررسی مدارک پیش می‌برد", () => {
    Svc.applyTransition({ caseId, transitionKey: "select_settlement", option: "direct", actor: staff });
    expect(stateOf(caseId)).toBe("payment_direct");

    const payment = Svc.recordPaymentAttempt({ caseId, method: "direct", actor: staff });
    expect(payment.status).toBe("succeeded");
    expect(payment.advancedTo).toBe("documents_review");
    expect(Finance.listInvoices(caseId)[0].status).toBe("paid");
    expect(Finance.listPayments(caseId)[0].status).toBe("succeeded");
  });

  it("تأیید مدارک، عبور از بند حقوقی (نیاز ندارد) و تولید سند قرارداد", () => {
    approveAllDocuments(caseId, admin);
    const approved = Svc.applyTransition({ caseId, transitionKey: "documents_all_approved", actor: admin });
    expect(approved.to).toBe("clause_edit_decision");

    const decision = Svc.applyTransition({ caseId, transitionKey: "clause_edit_needed", option: "not_needed", actor: staff });
    expect(decision.to).toBe("signature_prep");
    expect(Cases.findContractByCase(caseId)?.document_generated_at).toBeTruthy();
  });

  it("جمع امضای طرفین و بستن پرونده بدون کد رهگیری", () => {
    expect(Svc.applyTransition({ caseId, transitionKey: "start_signature", actor: staff }).to).toBe("signature_collect");
    Svc.markSignature({ caseId, party: "landlord", partyName: "حسن محمدی", status: "signed", actor: staff });
    Svc.markSignature({ caseId, party: "tenant", partyName: "علی رضایی", status: "signed", actor: staff });

    const applied = Svc.applyTransition({ caseId, transitionKey: "signature_check_done", actor: staff });
    expect(applied.to).toBe("contract_done_no_tracking");
    const row = Cases.findCaseById(caseId)!;
    expect(row.status).toBe("closed");
    expect(row.outcome).toBe("completed");
    expect(row.closed_at).toBeTruthy();
    expect(Cases.listSignatures(caseId).filter((s) => s.status === "signed")).toHaveLength(2);
  });

  it("تایم‌لاین، گذارها، اعلان‌ها و وب‌هوک خروجی ثبت شده‌اند", () => {
    const timeline = Cases.listTimeline(caseId);
    expect(timeline.length).toBeGreaterThanOrEqual(8);
    expect(timeline.some((e) => e.kind === "case.opened")).toBe(true);
    const transitions = Cases.listTransitions(caseId);
    expect(transitions.length).toBeGreaterThanOrEqual(8);
    expect(transitions[0].from_state).toBe("contract_start");
    expect(transitions.at(-1)?.to_state).toBe("contract_done_no_tracking");
    expect(Platform.listNotifications(caseId).length).toBeGreaterThan(0);
    expect(Platform.listWebhooks(20).some((w) => w.event === "case.completed" && w.case_id === caseId)).toBe(true);
    expect(Platform.listAudit(50).some((a) => a.entity_id === caseId)).toBe(true);
  });

  it("گزارش وضعیت پرونده برای پنل کامل است", () => {
    const detail = Svc.caseDetail(caseId);
    expect(detail.row.id).toBe(caseId);
    expect(detail.contract?.landlord_name).toBe("حسن محمدی");
    expect(detail.owner?.full_name).toBe("علی رضایی");
    expect(detail.stateInfo?.key).toBe("contract_done_no_tracking");
    expect(detail.transitions.length).toBeGreaterThanOrEqual(8);
  });
});

describe("پرونده قرارداد خرید و فروش (با کد رهگیری)", () => {
  let caseId = "";

  it("مسیر فروش: تنظیمات، بررسی مالی رایگان، مدارک و بررسی حقوقی", () => {
    const created = Svc.createCase({ serviceKey: "contract", title: "خرید و فروش ولنجک" });
    caseId = created.caseId;

    Svc.applyTransition({ caseId, transitionKey: "choose_contract_type", option: "sale", actor: staff });
    Svc.saveContractDetails(
      caseId,
      {
        contractType: "sale",
        outputMode: "signature_and_tracking",
        propertyAddress: "تهران، ولنجک، بلوار دانشجو",
        city: "تهران",
        district: "ولنجک",
        area: 120,
        sellerName: "مریم کاظمی",
        buyerName: "رضا نوری",
        salePrice: 9_500_000_000,
      },
      staff,
    );
    Svc.applyTransition({ caseId, transitionKey: "sale_info_submitted", actor: staff });
    const output = Svc.applyTransition({ caseId, transitionKey: "choose_output", option: "signature_and_tracking", actor: staff });
    expect(output.to).toBe("finance_check");
    expect(Cases.findCaseById(caseId)?.requires_tracking).toBe(1);

    const settlement = Svc.applyTransition({ caseId, transitionKey: "select_settlement", option: "free", actor: staff });
    expect(settlement.to).toBe("documents_review");

    approveAllDocuments(caseId, admin);
    expect(Svc.applyTransition({ caseId, transitionKey: "documents_all_approved", actor: admin }).to).toBe("legal_result");

    const legal = Svc.applyTransition({
      caseId,
      transitionKey: "legal_approved",
      payload: { decision: "approved", note: "بدون ایراد" },
      actor: admin,
    });
    expect(legal.to).toBe("signature_prep");
    expect(Cases.latestLegalReview(caseId)?.result).toBe("approved");
  });

  it("امضا، درخواست کد رهگیری و ثبت خطا/تلاش دوباره", () => {
    Svc.applyTransition({ caseId, transitionKey: "start_signature", actor: staff });
    Svc.markSignature({ caseId, party: "seller", status: "signed", actor: staff });
    Svc.markSignature({ caseId, party: "buyer", status: "signed", actor: staff });
    const applied = Svc.applyTransition({ caseId, transitionKey: "signature_check_done", actor: staff });
    expect(applied.to).toBe("tracking_check");

    const failed = Svc.applyTransition({
      caseId,
      transitionKey: "tracking_failed",
      reason: "سامانه املاک پاسخ نداد",
      actor: staff,
    });
    expect(failed.to).toBe("tracking_error");
    const tracking = Cases.findTracking(caseId)!;
    expect(tracking.attempts).toBe(1);
    expect(tracking.error).toContain("سامانه املاک");
    expect(Cases.listTasks({ caseId, status: ["open"] }).length).toBeGreaterThan(0);

    const retried = Svc.applyTransition({ caseId, transitionKey: "tracking_retry_request", actor: staff });
    expect(retried.to).toBe("tracking_check");
    expect(Cases.findTracking(caseId)!.attempts).toBe(1);
  });

  it("دریافت کد رهگیری پرونده را با موفقیت می‌بندد", () => {
    const applied = Svc.applyTransition({
      caseId,
      transitionKey: "tracking_received",
      payload: { code: "1405123456789" },
      actor: staff,
      idempotencyKey: "close-1",
    });
    expect(applied.to).toBe("contract_done_with_tracking");
    const tracking = Cases.findTracking(caseId)!;
    expect(tracking.status).toBe("received");
    expect(tracking.code).toBe("1405123456789");
    expect(Cases.findCaseById(caseId)?.status).toBe("closed");
  });

  it("تلاش دوباره با کلید idempotency نتیجه را تکرار نمی‌کند", () => {
    const before = Cases.listTransitions(caseId).length;
    const replay = Svc.applyTransition({
      caseId,
      transitionKey: "tracking_received",
      payload: { code: "1405123456789" },
      actor: staff,
      idempotencyKey: "close-1",
    });
    expect(replay.to).toBe("contract_done_with_tracking");
    expect(Cases.listTransitions(caseId).length).toBe(before);
    expect(Cases.findCaseById(caseId)!.status).toBe("closed");
  });
});

describe("حلقه‌های خطای قرارداد", () => {
  it("پرداخت ناموفق → تسویه دوباره → موفقیت", () => {
    const { caseId } = Svc.createCase({ serviceKey: "contract", title: "اجاره با خطای پرداخت" });
    Svc.applyTransition({ caseId, transitionKey: "choose_contract_type", option: "rent", actor: staff });
    Svc.saveContractDetails(
      caseId,
      {
        contractType: "rent",
        outputMode: "signature_only",
        propertyAddress: "تهران، پونک",
        landlordName: "حسن محمدی",
        tenantName: "علی رضایی",
        depositAmount: 100_000_000,
        rentAmount: 10_000_000,
        startDate: "1405/08/01",
        endDate: "1406/08/01",
      },
      staff,
    );
    Svc.applyTransition({ caseId, transitionKey: "rent_info_submitted", actor: staff });
    Svc.applyTransition({ caseId, transitionKey: "choose_output", option: "signature_only", actor: staff });
    Svc.applyTransition({ caseId, transitionKey: "select_settlement", option: "direct", actor: staff });

    const failed = Svc.recordPaymentAttempt({ caseId, method: "direct", simulateFailure: true, actor: staff });
    expect(failed.status).toBe("failed");
    expect(failed.advancedTo).toBe("payment_error");
    expect(Cases.listTasks({ caseId, status: ["open"] }).some((t) => t.title.includes("پرداخت"))).toBe(true);

    Svc.applyTransition({ caseId, transitionKey: "payment_retry", actor: staff });
    const success = Svc.recordPaymentAttempt({ caseId, method: "direct", actor: staff });
    expect(success.status).toBe("succeeded");
    expect(stateOf(caseId)).toBe("documents_review");
    expect(Cases.findCaseById(caseId)?.attempts_payment).toBe(1);
  });

  it("رد مدارک توسط کارشناس → اصلاح و بازگشت به بررسی", () => {
    const { caseId } = Svc.createCase({ serviceKey: "contract", title: "رد مدرک" });
    Svc.applyTransition({ caseId, transitionKey: "choose_contract_type", option: "rent", actor: staff });
    Svc.saveContractDetails(
      caseId,
      {
        contractType: "rent",
        outputMode: "signature_only",
        propertyAddress: "تهران، ونک",
        landlordName: "حسن محمدی",
        tenantName: "علی رضایی",
        rentAmount: 12_000_000,
        startDate: "1405/08/01",
        endDate: "1406/08/01",
      },
      staff,
    );
    Svc.applyTransition({ caseId, transitionKey: "rent_info_submitted", actor: staff });
    Svc.applyTransition({ caseId, transitionKey: "choose_output", option: "signature_only", actor: staff });
    Svc.applyTransition({ caseId, transitionKey: "select_settlement", option: "free", actor: staff });

    const firstDoc = Cases.listDocuments(caseId)[0];
    Svc.reviewDocumentAction({ documentId: firstDoc.id, status: "rejected", reviewNote: "تصویر ناخوانا", actor: admin });
    const rejected = Svc.applyTransition({
      caseId,
      transitionKey: "documents_rejected",
      reason: "سند مالکیت ناخوانا",
      payload: { needsFollowup: true },
      actor: admin,
    });
    expect(rejected.to).toBe("documents_rejected");
    expect(Cases.listDocuments(caseId).find((d) => d.id === firstDoc.id)?.status).toBe("rejected");

    const resubmitted = Svc.applyTransition({ caseId, transitionKey: "documents_resubmitted", actor: staff });
    expect(resubmitted.to).toBe("documents_review");
    // مدرک اصلاح‌شده تأیید می‌شود
    approveAllDocuments(caseId, admin);
    expect(Cases.listDocuments(caseId).every((d) => d.status === "approved")).toBe(true);
  });

  it("شکست سقف تلاش پرداخت پیام روشن می‌دهد", () => {
    const { caseId } = Svc.createCase({ serviceKey: "contract", title: "سقف تلاش" });
    Svc.applyTransition({ caseId, transitionKey: "choose_contract_type", option: "rent", actor: staff });
    Svc.saveContractDetails(
      caseId,
      {
        contractType: "rent",
        outputMode: "signature_only",
        propertyAddress: "تهران، جردن",
        landlordName: "حسن محمدی",
        tenantName: "علی رضایی",
        rentAmount: 12_000_000,
        startDate: "1405/08/01",
        endDate: "1406/08/01",
      },
      staff,
    );
    Svc.applyTransition({ caseId, transitionKey: "rent_info_submitted", actor: staff });
    Svc.applyTransition({ caseId, transitionKey: "choose_output", option: "signature_only", actor: staff });
    Svc.applyTransition({ caseId, transitionKey: "select_settlement", option: "direct", actor: staff });
    for (let i = 0; i < 5; i += 1) {
      if (i > 0) Svc.applyTransition({ caseId, transitionKey: "payment_retry", actor: staff });
      const attempt = Svc.recordPaymentAttempt({ caseId, method: "direct", simulateFailure: true, actor: staff });
      expect(attempt.advancedTo).toBe("payment_error");
    }
    expect(stateOf(caseId)).toBe("payment_error");
    expect(Cases.findCaseById(caseId)!.attempts_payment).toBe(5);
    expect(() => Svc.applyTransition({ caseId, transitionKey: "payment_retry", actor: staff })).toThrowError(/سقف تلاش/);
  });
});

describe("پرونده آگهی", () => {
  it("مسیر آگهی: مالی، اطلاعات، بررسی، انتشار، توقف و انقضا", () => {
    const { caseId } = Svc.createCase({ serviceKey: "listing", title: "آگهی آپارتمان ونک" });
    expect(stateOf(caseId)).toBe("listing_start");
    expect(Svc.applyTransition({ caseId, transitionKey: "listing_finance_check", actor: staff }).to).toBe("listing_finance");

    Svc.recordPaymentAttempt({ caseId, method: "direct", actor: staff });
    expect(Svc.applyTransition({ caseId, transitionKey: "listing_finance_ok", actor: staff }).to).toBe("listing_info");

    const listing = Catalog.findListingByCase(caseId)!;
    Catalog.updateListing(listing.id, {
      deal_type: "rent",
      property_type: "آپارتمان",
      city: "تهران",
      district: "ونک",
      area: 95,
      rooms: 2,
      deposit: 300_000_000,
      rent: 25_000_000,
      images: ["https://example.com/vanak-1.jpg"],
      description: "آپارتمان نورگیر نزدیک مترو",
    });

    expect(Svc.applyTransition({ caseId, transitionKey: "listing_info_submitted", actor: staff }).to).toBe("listing_review");
    expect(Svc.applyTransition({ caseId, transitionKey: "listing_expert_decision", actor: admin }).to).toBe("listing_result");

    const published = Svc.applyTransition({
      caseId,
      transitionKey: "listing_approved",
      payload: { decision: "approved" },
      actor: admin,
    });
    expect(published.to).toBe("listing_published");
    const afterPublish = Catalog.findListingByCase(caseId)!;
    expect(afterPublish.status).toBe("published");
    expect(afterPublish.expires_at).toBeTruthy();

    expect(Svc.applyTransition({ caseId, transitionKey: "listing_pause", actor: admin }).to).toBe("listing_paused");
    expect(Catalog.findListingByCase(caseId)!.status).toBe("paused");
    expect(Svc.applyTransition({ caseId, transitionKey: "listing_resume", actor: admin }).to).toBe("listing_published");

    // انقضا: تاریخ گذشته و سپس گذار خودکار
    Catalog.updateListing(listing.id, { expires_at: "2020-01-01T00:00:00.000Z" });
    const expired = Svc.applyTransition({ caseId, transitionKey: "listing_expire", actor: staff });
    expect(expired.to).toBe("listing_expired");
    expect(Catalog.findListingByCase(caseId)!.status).toBe("expired");
    expect(Cases.findCaseById(caseId)!.status).toBe("closed");
  });

  it("رد آگهی با دلیل → اصلاح و ارسال دوباره", () => {
    const { caseId } = Svc.createCase({ serviceKey: "listing", title: "آگهی نیازمند اصلاح" });
    Svc.applyTransition({ caseId, transitionKey: "listing_finance_check", actor: staff });
    Svc.recordPaymentAttempt({ caseId, method: "direct", actor: staff });
    Svc.applyTransition({ caseId, transitionKey: "listing_finance_ok", actor: staff });
    const listing = Catalog.findListingByCase(caseId)!;
    Catalog.updateListing(listing.id, {
      city: "تهران",
      district: "پونک",
      area: 80,
      rent: 18_000_000,
      images: ["https://example.com/poonak.jpg"],
    });
    Svc.applyTransition({ caseId, transitionKey: "listing_info_submitted", actor: staff });
    Svc.applyTransition({ caseId, transitionKey: "listing_expert_decision", actor: admin });

    const needsFix = Svc.applyTransition({
      caseId,
      transitionKey: "listing_needs_fix",
      reason: "تصویر نامناسب است",
      actor: admin,
    });
    expect(needsFix.to).toBe("listing_needs_fix");
    expect(Catalog.findListingByCase(caseId)!.status).not.toBe("published");

    Catalog.updateListing(listing.id, { images: ["https://example.com/poonak-2.jpg"] });
    expect(Svc.applyTransition({ caseId, transitionKey: "listing_resubmitted", actor: staff }).to).toBe("listing_info");
  });
});

describe("پرونده نیازمندی", () => {
  it("سطح دسترسی، تطبیق خودکار و تحقق نیازمندی", () => {
    const created = Svc.createCase({ serviceKey: "requirements", title: "نیازمندی اجاره سعادت‌آباد" });
    const caseId = created.caseId;
    const visible = Svc.applyTransition({ caseId, transitionKey: "set_access_level", option: "agents", actor: staff });
    expect(visible.to).toBe("requirements_visible");
    expect(Cases.findCaseById(caseId)?.access_level).toBe("agents");

    const requirement = Catalog.findRequirementByCase(caseId)!;
    Catalog.updateRequirement(requirement.id, {
      deal_type: "rent",
      property_type: "آپارتمان",
      city: "تهران",
      districts: ["سعادت‌آباد"],
      budget_max: 30_000_000,
      area_min: 85,
      rooms: 2,
      access_level: "agents",
    });

    // یک آگهی منتشرشده هم‌خوان برای تطبیق ساخته می‌شود
    Catalog.createListing({
      deal_type: "rent",
      property_type: "آپارتمان",
      city: "تهران",
      district: "سعادت‌آباد",
      area: 100,
      rooms: 2,
      deposit: 150_000_000,
      rent: 22_000_000,
      status: "published",
      images: JSON.stringify(["https://example.com/saadat.jpg"]),
    });

    expect(Svc.applyTransition({ caseId, transitionKey: "match_requirements", actor: staff }).to).toBe("requirements_matching");
    const found = Svc.computeMatchesForCase(caseId);
    expect(found).toBeGreaterThan(0);
    expect(Svc.applyTransition({ caseId, transitionKey: "publish_matches", actor: staff }).to).toBe("requirements_matched");

    const fulfilled = Svc.applyTransition({
      caseId,
      transitionKey: "fulfill_requirement",
      reason: "قرارداد اجاره با موفقیت بسته شد",
      actor: staff,
    });
    expect(fulfilled.to).toBe("requirements_fulfilled");
    expect(Catalog.findRequirementByCase(caseId)!.status).toBe("fulfilled");
    expect(Cases.findCaseById(caseId)!.status).toBe("closed");
  });

  it("نیازمندی بدون تطبیق اجازه انتشار نمی‌گیرد", () => {
    const { caseId } = Svc.createCase({ serviceKey: "requirements", title: "نیازمندی بدون تطبیق" });
    Svc.applyTransition({ caseId, transitionKey: "set_access_level", option: "staff", actor: staff });
    Svc.applyTransition({ caseId, transitionKey: "match_requirements", actor: staff });
    expect(() => Svc.applyTransition({ caseId, transitionKey: "publish_matches", actor: staff })).toThrowError(/متناسب/);
  });
});

describe("پرونده خدمت سفارشی", () => {
  it("مسیر خدمت: اطلاعات، مالی، اجرا، بررسی و تحویل", () => {
    const { caseId } = Svc.createCase({ serviceKey: "custom_service", title: "استعلام حقوقی" });
    expect(Svc.applyTransition({ caseId, transitionKey: "service_info_submitted", actor: staff }).to).toBe("service_details");
    expect(Svc.applyTransition({ caseId, transitionKey: "service_finance_check", actor: staff }).to).toBe("service_finance");
    expect(Finance.listInvoices(caseId)).toHaveLength(1);

    const payment = Svc.recordPaymentAttempt({ caseId, method: "direct", actor: staff });
    expect(payment.advancedTo).toBe("service_execution");

    expect(Svc.applyTransition({ caseId, transitionKey: "service_deliver", actor: staff }).to).toBe("service_review");
    expect(
      Svc.applyTransition({
        caseId,
        transitionKey: "service_approved",
        payload: { decision: "approved" },
        actor: admin,
      }).to,
    ).toBe("service_delivered");
    expect(Cases.findCaseById(caseId)!.status).toBe("closed");
  });

  it("درخواست اصلاح خدمت → اجرای دوباره", () => {
    const { caseId } = Svc.createCase({ serviceKey: "custom_service", title: "خدمت نیازمند اصلاح" });
    Svc.applyTransition({ caseId, transitionKey: "service_info_submitted", actor: staff });
    Svc.applyTransition({ caseId, transitionKey: "service_finance_check", actor: staff });
    Svc.recordPaymentAttempt({ caseId, method: "direct", actor: staff });
    Svc.applyTransition({ caseId, transitionKey: "service_deliver", actor: staff });

    const fix = Svc.applyTransition({
      caseId,
      transitionKey: "service_fix_requested",
      reason: "گزارش ناقص است",
      payload: { needsFollowup: true },
      actor: admin,
    });
    expect(fix.to).toBe("service_needs_fix");
    expect(Svc.applyTransition({ caseId, transitionKey: "service_redo", actor: staff }).to).toBe("service_execution");
  });

  it("لغو خدمت با دلیل پرونده را می‌بندد", () => {
    const { caseId } = Svc.createCase({ serviceKey: "custom_service", title: "خدمت لغوشده" });
    Svc.applyTransition({ caseId, transitionKey: "service_info_submitted", actor: staff });
    const cancelled = Svc.applyTransition({
      caseId,
      transitionKey: "service_cancel",
      reason: "درخواست مشتری لغو شد",
      actor: staff,
    });
    expect(cancelled.to).toBe("service_cancelled");
    expect(Cases.findCaseById(caseId)!.status).toBe("closed");
  });
});

describe("پرس‌وجوی پنل", () => {
  it("شمارش و فهرست پرونده‌ها برای داشبورد درست است", () => {
    expect(Cases.countOpenCases()).toBeGreaterThan(0);
    expect(Cases.countOpenTasks().total).toBeGreaterThan(0);
    const open = Cases.listCases({ status: "open", limit: 100 });
    expect(open.length).toBeGreaterThan(0);
    const states = Cases.countCasesByState(["payment_error", "documents_review"]);
    expect(typeof states).toBe("object");
    const search = Cases.listCases({ search: "آگهی", limit: 10 });
    expect(search.length).toBeGreaterThan(0);
    expect(Finance.paymentStats().paidMonth).toBeGreaterThan(0);
  });

  it("وظایف باز و سررسیدگذشته شمرده می‌شوند", () => {
    const task = Svc.createCase({ serviceKey: "contract", title: "پرونده برای وظیفه" }).caseId;
    Cases.createTask({ caseId: task, title: "تماس با مشتری", dueAt: "2020-01-01T00:00:00.000Z" });
    const list = Cases.listTasks({ overdue: true, limit: 50 });
    expect(list.some((t) => t.case_id === task)).toBe(true);
  });
});
