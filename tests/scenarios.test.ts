/**
 * سناریوهای سرتاسری پذیرش (بند ۱۱ سند طراحی) — اجرای کامل روی موتور.
 * هر سناریو مسیر دقیق فلوچارت را گام‌به‌گام طی می‌کند و وضعیت/رویداد/وظیفه را می‌سنجد.
 */
import { describe, expect, it } from "vitest";
import {
  admin, apply, documents, engine, makeRuntime, rentContract, saleContract, signatures, staff,
} from "./helpers/harness";
import type { CaseRuntime, ListingRuntime, RequirementRuntime } from "@/domain/engine/types";

const systemActor = { type: "system" as const, name: "موتور" };

describe("سناریو ۱ — قرارداد اجاره، پرداخت مستقیم، فقط امضا", () => {
  it("از انتخاب نوع تا اتمام قرارداد و رویداد CRM", () => {
    const eng = engine();
    let r: CaseRuntime = makeRuntime({ state: "contract_start" });

    r = apply(eng, r, { transitionKey: "choose_contract_type", option: "rent", actor: staff }).runtime;
    expect(r.state).toBe("rent_info");

    // کارمند اطلاعات اجاره را ثبت می‌کند (در اپ: POST /contract-detail)
    r = { ...r, contract: rentContract() };
    r = apply(eng, r, { transitionKey: "rent_info_submitted", actor: staff, payload: {} }).runtime;
    expect(r.state).toBe("output_choice");

    r = apply(eng, r, { transitionKey: "choose_output", option: "signature_only", actor: staff }).runtime;
    expect(r.state).toBe("finance_check");
    expect(r.code).toBeTruthy();
    expect(r.invoices.length).toBe(1);
    expect(r.requiresTracking).toBe(false);

    r = apply(eng, r, { transitionKey: "select_settlement", option: "direct", actor: staff }).runtime;
    expect(r.state).toBe("payment_direct");

    r = { ...r, payments: [{ id: "p1", method: "direct", status: "failed", amount: 500_000 }] };
    const failed = apply(eng, r, { transitionKey: "payment_failed", actor: systemActor, payload: { paymentResult: "failed", paymentId: "p1" } });
    r = failed.runtime;
    expect(r.state).toBe("payment_error");
    expect(failed.plan.tasks[0]?.title).toContain("پیگیری پرداخت");

    r = apply(eng, r, { transitionKey: "payment_retry", actor: staff }).runtime;
    r = { ...r, payments: [...r.payments, { id: "p2", method: "direct", status: "succeeded", amount: 500_000 }] };
    r = apply(eng, r, { transitionKey: "payment_succeeded", actor: systemActor }).runtime;
    expect(r.state).toBe("documents_review");

    r = { ...r, documents: documents(["submitted", "submitted"]) };
    r = apply(eng, r, { transitionKey: "documents_pending", actor: staff }).runtime;
    expect(r.state).toBe("documents_pending_queue");

    r = apply(eng, r, { transitionKey: "documents_expert_decided", actor: staff }).runtime;
    expect(r.state).toBe("documents_review");

    r = { ...r, documents: documents(["approved", "approved"]) };
    r = apply(eng, r, { transitionKey: "documents_all_approved", actor: staff }).runtime;
    expect(r.state).toBe("clause_edit_decision"); // اجاره: بدون نیاز به بررسی حقوقی

    r = apply(eng, r, { transitionKey: "clause_edit_needed", option: "not_needed", actor: staff }).runtime;
    expect(r.state).toBe("signature_prep");

    const prepared = apply(eng, r, { transitionKey: "start_signature", actor: staff });
    r = prepared.runtime;
    expect(r.state).toBe("signature_collect");
    expect(r.signatures.map((s) => s.party)).toEqual(["landlord", "tenant"]);
    expect(r.signatures.every((s) => s.status === "pending")).toBe(true);

    const incomplete = apply(eng, r, { transitionKey: "signature_check_done", actor: staff });
    r = incomplete.runtime;
    expect(r.state).toBe("signature_followup");
    expect(incomplete.plan.tasks[0]?.title).toContain("امضاهای باقی‌مانده");

    r = { ...r, signatures: signatures(["signed", "signed"]) };
    const done = apply(eng, r, { transitionKey: "signature_check_done", actor: staff });
    r = done.runtime;
    expect(r.state).toBe("contract_done_no_tracking");
    expect(r.status).toBe("closed");
    expect(r.outcome).toBe("completed");
    // رویداد CRM در حالت پایانی
    expect(done.plan.events.some((e) => e.kind === "crm.timeline")).toBe(true);
    expect(done.plan.outbound.some((e) => e.event === "case.completed")).toBe(true);
  });
});

describe("سناریو ۲ — خرید و فروش با کد رهگیری، دو دور اصلاح بند، خطای پرداخت و مدارک", () => {
  it("مسیر کامل با همه حلقه‌های خطا و بازیابی", () => {
    const eng = engine();
    let r: CaseRuntime = makeRuntime({
      state: "contract_start",
      serviceKey: "contract",
      requiredSignatures: ["seller", "buyer"],
    });

    r = apply(eng, r, { transitionKey: "choose_contract_type", option: "sale", actor: staff }).runtime;
    r = { ...r, contract: saleContract() };
    r = apply(eng, r, { transitionKey: "sale_info_submitted", actor: staff }).runtime;
    r = apply(eng, r, { transitionKey: "choose_output", option: "signature_and_tracking", actor: staff }).runtime;
    expect(r.state).toBe("finance_check");
    expect(r.requiresTracking).toBe(true);

    r = apply(eng, r, { transitionKey: "select_settlement", option: "direct", actor: staff }).runtime;
    r = { ...r, payments: [{ id: "p1", method: "direct", status: "failed", amount: 500_000 }] };
    r = apply(eng, r, { transitionKey: "payment_failed", actor: systemActor, payload: { paymentResult: "failed", paymentId: "p1" } }).runtime;
    expect(r.state).toBe("payment_error");
    r = apply(eng, r, { transitionKey: "payment_retry", actor: staff }).runtime;
    r = { ...r, payments: [...r.payments, { id: "p2", method: "direct", status: "succeeded", amount: 500_000 }] };
    r = apply(eng, r, { transitionKey: "payment_succeeded", actor: systemActor }).runtime;
    expect(r.state).toBe("documents_review");

    // دوره اول مدارک ناقص
    r = { ...r, documents: documents(["submitted", "incomplete"]) };
    const incomplete = apply(eng, r, { transitionKey: "documents_incomplete", actor: staff, reason: "سند مالکیت ناخواناست" });
    r = incomplete.runtime;
    expect(r.state).toBe("documents_incomplete");
    expect(incomplete.plan.notifications[0]?.body).toContain("مدارک");
    r = { ...r, documents: documents(["submitted", "submitted"]) };
    r = apply(eng, r, { transitionKey: "documents_resubmitted", actor: staff }).runtime;
    expect(r.state).toBe("documents_review");

    r = { ...r, documents: documents(["approved", "approved"]) };
    r = apply(eng, r, { transitionKey: "documents_all_approved", actor: staff }).runtime;
    // خرید و فروش → بررسی حقوقی → آماده ثبت نتیجه (زنجیره خودکار)
    expect(r.state).toBe("legal_result");

    // دور اول: نیاز به اصلاح بند
    r = apply(eng, r, {
      transitionKey: "legal_needs_edit", actor: staff,
      payload: { decision: "needs_edit", note: "بند جریمه تأخیر اصلاح شود" },
    }).runtime;
    expect(r.state).toBe("clause_edit");
    r = apply(eng, r, {
      transitionKey: "clause_edit_done", actor: staff,
      payload: { revisionNote: "بند جریمه بازنویسی شد" },
    }).runtime;
    expect(r.state).toBe("legal_result");
    expect(r.contract?.clauseVersion).toBe(2);

    // دور دوم: نیاز به اصلاح دیگر
    r = apply(eng, r, { transitionKey: "legal_needs_edit", actor: staff, payload: { decision: "needs_edit" } }).runtime;
    expect(r.state).toBe("clause_edit");
    r = apply(eng, r, { transitionKey: "clause_edit_done", actor: staff, payload: { revisionNote: "بند بازگشت وجه" } }).runtime;
    expect(r.contract?.clauseVersion).toBe(3);

    // تأیید حقوقی → آماده‌سازی امضا (سند تولید می‌شود)
    const approved = apply(eng, r, {
      transitionKey: "legal_approved", actor: staff,
      payload: { decision: "approved", note: "بدون ایراد" },
    });
    r = approved.runtime;
    expect(r.state).toBe("signature_prep");
    expect(r.contract?.documentGeneratedAt).toBeTruthy();

    r = apply(eng, r, { transitionKey: "start_signature", actor: staff }).runtime;
    r = { ...r, signatures: signatures(["signed", "signed"], ["seller", "buyer"]) };
    const signatureOk = apply(eng, r, { transitionKey: "signature_check_done", actor: staff });
    r = signatureOk.runtime;
    // signature_check → tracking_decision → درخواست کد → صف بررسی کد
    expect(r.state).toBe("tracking_check");
    expect(signatureOk.plan.outbound.some((e) => e.event === "tracking.requested")).toBe(true);

    // خطای کد رهگیری و تلاش مجدد
    const trackingError = apply(eng, r, { transitionKey: "tracking_failed", actor: staff, reason: "سامانه پاسخ نداد" });
    r = trackingError.runtime;
    expect(r.state).toBe("tracking_error");
    expect(r.attempts.tracking).toBe(1);
    r = apply(eng, r, { transitionKey: "tracking_retry_request", actor: staff }).runtime;
    expect(r.state).toBe("tracking_check");

    const received = apply(eng, r, {
      transitionKey: "tracking_received", actor: staff, payload: { code: "1405123456789" },
    });
    r = received.runtime;
    expect(r.state).toBe("contract_done_with_tracking");
    expect(r.tracking?.code).toBe("1405123456789");
    expect(r.status).toBe("closed");
  });
});

describe("سناریو ۳ — رد قرارداد در بررسی حقوقی", () => {
  it("ثبت دلیل و بستن پرونده با وظیفه پیگیری", () => {
    const eng = engine();
    let r: CaseRuntime = makeRuntime({
      state: "legal_result",
      contract: saleContract(),
      documents: documents(["approved", "approved"]),
    });
    const rejected = apply(eng, r, {
      transitionKey: "legal_rejected", actor: staff,
      reason: "سند مالکیت با هویت فروشنده هم‌خوان نیست",
      payload: { decision: "rejected", note: "مغایرت سند" },
    });
    r = rejected.runtime;
    expect(r.state).toBe("contract_rejected");
    expect(r.status).toBe("closed");
    expect(r.outcome).toBe("rejected");
    expect(rejected.plan.events.some((e) => e.kind === "legal.rejected")).toBe(true);
    expect(rejected.plan.tasks.some((t) => t.title.includes("رد قرارداد"))).toBe(true);
    expect(rejected.plan.notifications[0]?.template).toBe("contract_rejected");
  });
});

describe("سناریو ۴ — آگهی: مالی، بررسی، اصلاح، انتشار و مدیریت وضعیت", () => {
  const listing = (overrides: Partial<ListingRuntime> = {}): ListingRuntime => ({
    id: "listing-1",
    dealType: "rent",
    propertyType: "آپارتمان",
    city: "تهران",
    district: "ونک",
    address: "خیابان ملاصدرا، پلاک ۵",
    area: 88,
    rooms: 2,
    price: null,
    deposit: 300_000_000,
    rent: 25_000_000,
    description: "نورگیر، طبقه سوم",
    images: ["1.jpg"],
    status: "draft",
    expiresAt: null,
    ...overrides,
  });

  it("از شروع تا انتشار، توقف، انتشار مجدد و بستن", () => {
    const eng = engine("listing");
    let r: CaseRuntime = makeRuntime({
      state: "listing_start",
      serviceKey: "listing",
      workflowKey: "listing",
      listing: listing(),
      settings: { serviceRequiresPayment: false },
    });

    r = apply(eng, r, { transitionKey: "listing_finance_check", actor: systemActor }).runtime;
    expect(r.state).toBe("listing_finance");

    r = { ...r, payments: [{ id: "p1", method: "direct", status: "succeeded", amount: 200_000 }] };
    r = apply(eng, r, { transitionKey: "listing_finance_ok", actor: staff }).runtime;
    expect(r.state).toBe("listing_info");

    // آگهی بدون تصویر → گارد رد می‌کند
    const noImage: CaseRuntime = { ...r, listing: listing({ images: [] }) };
    expect(() => eng.plan({ runtime: noImage, transitionKey: "listing_info_submitted", actor: staff })).toThrow(/تصویر/);

    r = apply(eng, r, { transitionKey: "listing_info_submitted", actor: staff }).runtime;
    expect(r.state).toBe("listing_review");

    r = apply(eng, r, { transitionKey: "listing_expert_decision", actor: staff }).runtime;
    expect(r.state).toBe("listing_result");

    const fix = apply(eng, r, { transitionKey: "listing_needs_fix", actor: staff, reason: "قیمت اجاره با بازار هم‌خوان نیست" });
    r = fix.runtime;
    expect(r.state).toBe("listing_needs_fix");
    expect(fix.plan.notifications[0]?.template).toBe("listing_needs_fix");

    r = { ...r, listing: { ...listing(), rent: 22_000_000 } };
    r = apply(eng, r, { transitionKey: "listing_resubmitted", actor: staff }).runtime;
    expect(r.state).toBe("listing_info");
    r = apply(eng, r, { transitionKey: "listing_info_submitted", actor: staff }).runtime;
    r = apply(eng, r, { transitionKey: "listing_expert_decision", actor: staff }).runtime;

    const published = apply(eng, r, { transitionKey: "listing_approved", actor: staff, payload: { decision: "approved" } });
    r = published.runtime;
    expect(r.state).toBe("listing_published");
    expect(r.listing?.status).toBe("published");
    expect(r.listing?.expiresAt).toBeTruthy();
    expect(published.plan.outbound.some((e) => e.event === "listing.published")).toBe(true);

    r = apply(eng, r, { transitionKey: "listing_pause", actor: staff }).runtime;
    expect(r.state).toBe("listing_paused");
    expect(r.listing?.status).toBe("paused");

    r = apply(eng, r, { transitionKey: "listing_resume", actor: staff }).runtime;
    expect(r.listing?.status).toBe("published");

    r = apply(eng, r, { transitionKey: "listing_close", actor: staff, reason: "معامله انجام شد" }).runtime;
    expect(r.state).toBe("listing_closed");
    expect(r.listing?.status).toBe("closed");
    expect(r.outcome).toBe("closed");
  });
});

describe("سناریو ۵ — نیازمندی‌ها: نمایش طبق دسترسی، تطبیق، تأمین", () => {
  const requirement = (overrides: Partial<RequirementRuntime> = {}): RequirementRuntime => ({
    id: "req-1",
    dealType: "rent",
    propertyType: "آپارتمان",
    city: "تهران",
    districts: ["ونک", "سعادت‌آباد"],
    budgetMin: 20_000_000,
    budgetMax: 35_000_000,
    areaMin: 70,
    areaMax: 110,
    rooms: 2,
    accessLevel: "staff",
    status: "open",
    expiresAt: null,
    ...overrides,
  });

  it("مسیر کامل با تطبیق و تأمین", () => {
    const eng = engine("requirements");
    let r: CaseRuntime = makeRuntime({
      state: "requirements_start",
      serviceKey: "requirements",
      workflowKey: "requirements",
      requirement: requirement(),
      settings: { serviceRequiresPayment: false },
    });

    r = apply(eng, r, { transitionKey: "set_access_level", option: "agents", actor: staff }).runtime;
    expect(r.state).toBe("requirements_visible");
    expect(r.requirement?.accessLevel).toBe("agents");

    r = apply(eng, r, { transitionKey: "match_requirements", actor: staff }).runtime;
    expect(r.state).toBe("requirements_matching");

    // بدون تطبیق، گارد رد می‌کند
    expect(() => eng.plan({ runtime: r, transitionKey: "publish_matches", actor: staff })).toThrow(/متناسب/);

    r = { ...r, matches: [{ id: "m1", listingId: "listing-9", score: 0.87 }] };
    const matched = apply(eng, r, { transitionKey: "publish_matches", actor: staff });
    r = matched.runtime;
    expect(r.state).toBe("requirements_matched");
    expect(matched.plan.notifications[0]?.template).toBe("requirement_matches");

    r = apply(eng, r, { transitionKey: "fulfill_requirement", actor: staff, reason: "قرارداد با پیشنهاد شماره ۹ بسته شد" }).runtime;
    expect(r.state).toBe("requirements_fulfilled");
    expect(r.outcome).toBe("fulfilled");
  });
});

describe("سناریو ۶ — سایر خدمات (نمونه: استعلام سند)", () => {
  it("اجرا، اصلاح و تحویل نتیجه", () => {
    const eng = engine("custom_service");
    let r: CaseRuntime = makeRuntime({
      state: "service_start",
      serviceKey: "deed_inquiry",
      workflowKey: "custom_service",
      requiredDocuments: [],
      settings: { serviceRequiresPayment: true, servicePrice: 300_000 },
    });

    r = apply(eng, r, { transitionKey: "service_info_submitted", actor: staff }).runtime;
    expect(r.state).toBe("service_details");

    r = apply(eng, r, { transitionKey: "service_finance_check", actor: systemActor }).runtime;
    expect(r.state).toBe("service_finance");
    expect(r.invoices.length).toBe(1);

    r = { ...r, payments: [{ id: "p1", method: "direct", status: "succeeded", amount: 300_000 }] };
    r = apply(eng, r, { transitionKey: "service_finance_ok", actor: staff }).runtime;
    expect(r.state).toBe("service_execution");

    r = apply(eng, r, { transitionKey: "service_deliver", actor: staff }).runtime;
    expect(r.state).toBe("service_review");

    const fix = apply(eng, r, { transitionKey: "service_fix_requested", actor: staff, reason: "گزارش ناقص است" });
    r = fix.runtime;
    expect(r.state).toBe("service_needs_fix");

    r = apply(eng, r, { transitionKey: "service_redo", actor: staff }).runtime;
    expect(r.state).toBe("service_execution");
    r = apply(eng, r, { transitionKey: "service_deliver", actor: staff }).runtime;

    const delivered = apply(eng, r, { transitionKey: "service_approved", actor: staff, payload: { decision: "approved" } });
    r = delivered.runtime;
    expect(r.state).toBe("service_delivered");
    expect(r.outcome).toBe("delivered");
  });
});

describe("سناریو ۷ — کنترل دسترسی", () => {
  it("کارمند نمی‌تواند گذار مدیر را اجرا کند (انصراف از کد رهگیری مخصوص مدیر است)", () => {
    const eng = engine();
    const r = makeRuntime({
      state: "tracking_error",
      requiresTracking: true,
      tracking: { status: "error", code: null, error: "پاسخ سامانه نرسید", attempts: 1 },
    });
    expect(() => eng.plan({ runtime: r, transitionKey: "tracking_abort", actor: staff, reason: "انصراف" })).toThrow(/مدیر/);
    expect(() => eng.plan({ runtime: r, transitionKey: "tracking_abort", actor: admin, reason: "انصراف" })).not.toThrow();
  });
});
