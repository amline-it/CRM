/**
 * گاردهای نام‌دار — شرط‌های عبور گذارها.
 * همه فقط از «وضعیت جهان» (CaseRuntime) می‌خوانند: بدون I/O، قابل تست کامل.
 */
import type { GuardContext, GuardRegistry, GuardResult } from "@/domain/engine/types";

const ok = true;
const fail = (message: string): GuardResult => ({ ok: false, message });

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function isContractReady(ctx: GuardContext, type: "rent" | "sale"): GuardResult {
  const c = ctx.runtime.contract;
  if (!c) return fail("اطلاعات قرارداد ثبت نشده است");
  if (c.contractType !== type) return fail("نوع قرارداد با این گذار هم‌خوان نیست");
  if (type === "rent") {
    if (!c.propertyAddress || !c.landlordName || !c.tenantName) return fail("برای اجاره، آدرس ملک و نام مالک و مستأجر الزامی است");
    if (num(c.depositAmount) === null && num(c.rentAmount) === null) return fail("مبلغ ودیعه یا اجاره باید ثبت شود");
    if (!c.startDate || !c.endDate) return fail("تاریخ شروع و پایان اجاره الزامی است");
  } else {
    if (!c.propertyAddress || !c.sellerName || !c.buyerName) return fail("برای خرید و فروش، آدرس ملک و نام فروشنده و خریدار الزامی است");
    if (num(c.salePrice) === null) return fail("مبلغ فروش باید ثبت شود");
  }
  return ok;
}

export const guards: Record<string, (ctx: GuardContext) => GuardResult> = {
  has_reason: (ctx) => {
    if (ctx.payload.__skipReason === true) return ok;
    const reason = (ctx.reason ?? "").trim();
    if (reason.length < 3) return fail("ثبت دلیل الزامی است (حداقل ۳ حرف)");
    return ok;
  },

  contract_details_complete: (ctx) => isContractReady(ctx, (ctx.params.type as "rent" | "sale") ?? ctx.runtime.contract?.contractType ?? "rent"),

  payment_succeeded: (ctx) => {
    const payments = ctx.runtime.payments ?? [];
    if (!payments.length) return fail("هیچ پرداختی برای این پرونده ثبت نشده است");
    const last = payments[payments.length - 1];
    if (last.status !== "succeeded") return fail("آخرین پرداخت موفق نبوده است");
    return ok;
  },

  payment_result_is: (ctx) => {
    const expected = String(ctx.params.status ?? "failed");
    const fromPayload = typeof ctx.payload.paymentResult === "string" ? ctx.payload.paymentResult : null;
    if (fromPayload) {
      return fromPayload === expected ? ok : fail(`نتیجه پرداخت «${fromPayload}» با این گذار هم‌خوان نیست`);
    }
    const paymentId = typeof ctx.payload.paymentId === "string" ? ctx.payload.paymentId : null;
    if (paymentId) {
      const payment = (ctx.runtime.payments ?? []).find((p) => p.id === paymentId);
      if (!payment) return fail("پرداخت موردنظر یافت نشد");
      return payment.status === expected ? ok : fail(`وضعیت پرداخت «${payment.status}» است`);
    }
    return fail("نتیجه پرداخت مشخص نیست؛ ابتدا تلاش پرداخت را ثبت کنید");
  },

  settlement_method_is: (ctx) => {
    const method = String(ctx.params.method ?? "");
    const invoice = ctx.runtime.invoices?.[0];
    if (!invoice) return fail("فاکتور خدمت صادر نشده است");
    const payment = ctx.runtime.payments?.find((p) => p.method === method);
    if (!payment) return fail(`این گذار فقط برای روش تسویه «${method}» مجاز است`);
    return ok;
  },

  subscription_valid: (ctx) => {
    const sub = ctx.runtime.subscription;
    if (!sub) return fail("اشتراکی برای این کاربر یافت نشد");
    if (sub.status !== "active") return fail("اشتراک منقضی شده است");
    if (sub.endsAt && new Date(sub.endsAt).getTime() < ctx.now.getTime()) return fail("تاریخ اعتبار اشتراک گذشته است");
    const scope = sub.scope ?? [];
    if (scope.length && !scope.includes(ctx.runtime.serviceKey) && !scope.includes("*")) {
      return fail("این اشتراک شامل خدمت جاری نمی‌شود");
    }
    return ok;
  },

  referral_approved: (ctx) => {
    const ref = ctx.runtime.referral;
    if (!ref) return fail("کد ریفرال یا معافیت برای این پرونده ثبت نشده است");
    if (ref.status !== "approved") return fail("وضعیت کد ریفرال/معافیت «تأییدشده» نیست");
    const scope = ref.scope ?? [];
    if (scope.length && !scope.includes(ctx.runtime.serviceKey) && !scope.includes("*")) {
      return fail("این کد برای خدمت جاری تعریف نشده است");
    }
    return ok;
  },

  all_documents_approved: (ctx) => {
    const docs = ctx.runtime.documents ?? [];
    if (!docs.length) return fail("هیچ مدرکی برای این پرونده ثبت نشده است");
    const pending = docs.filter((d) => d.status !== "approved");
    if (pending.length) {
      return fail(`هنوز ${pending.length} مدرک تأیید نشده است: ${pending.map((d) => d.title).join("، ")}`);
    }
    return ok;
  },

  documents_incomplete: (ctx) => {
    const required = ctx.runtime.requiredDocuments ?? [];
    const uploaded = new Set((ctx.runtime.documents ?? []).map((d) => d.kind));
    const missing = required.filter((kind) => !uploaded.has(kind));
    if (!missing.length) return fail("مدرک ناقصی وجود ندارد");
    return ok;
  },

  documents_rejected: (ctx) => {
    const rejected = (ctx.runtime.documents ?? []).filter((d) => d.status === "rejected");
    if (!rejected.length) return fail("مدرک رد‌شده‌ای وجود ندارد");
    return ok;
  },

  documents_pending: (ctx) => {
    const pending = (ctx.runtime.documents ?? []).filter((d) => d.status === "submitted" || d.status === "pending");
    if (!pending.length) return fail("مدرکی در انتظار بررسی نیست");
    return ok;
  },

  contract_is_sale: (ctx) => {
    if (!ctx.runtime.contract) return fail("اطلاعات قرارداد ثبت نشده است");
    return ctx.runtime.contract.contractType === "sale" ? ok : fail("این گذار مخصوص قرارداد خرید و فروش است");
  },

  contract_is_rent: (ctx) => {
    if (!ctx.runtime.contract) return fail("اطلاعات قرارداد ثبت نشده است");
    return ctx.runtime.contract.contractType === "rent" ? ok : fail("این گذار مخصوص قرارداد اجاره است");
  },

  legal_approved: (ctx) => {
    const decided = ctx.payload.decision ?? ctx.runtime.legalReview?.result;
    if (!decided) return fail("نتیجه بررسی حقوقی ثبت نشده است");
    return decided === "approved" ? ok : fail("نتیجه بررسی حقوقی «تأیید» نیست");
  },

  legal_needs_edit: (ctx) => {
    const decided = ctx.payload.decision ?? ctx.runtime.legalReview?.result;
    if (!decided) return fail("نتیجه بررسی حقوقی ثبت نشده است");
    return decided === "needs_edit" ? ok : fail("نتیجه بررسی حقوقی «نیاز به اصلاح» نیست");
  },

  legal_rejected: (ctx) => {
    const decided = ctx.payload.decision ?? ctx.runtime.legalReview?.result;
    if (!decided) return fail("نتیجه بررسی حقوقی ثبت نشده است");
    return decided === "rejected" ? ok : fail("نتیجه بررسی حقوقی «رد» نیست");
  },

  contract_document_ready: (ctx) => {
    const c = ctx.runtime.contract;
    if (!c) return fail("اطلاعات قرارداد ثبت نشده است");
    if (!c.documentGeneratedAt) return fail("سند قرارداد هنوز تولید نشده است");
    if (!c.termsNote && !c.propertyAddress) return fail("متن قرارداد کامل نیست");
    return ok;
  },

  has_clause_revision: (ctx) => {
    const c = ctx.runtime.contract;
    const r = ctx.runtime.legalReview;
    if (!c) return fail("اطلاعات قرارداد ثبت نشده است");
    const baseline = r?.clauseVersionAtReview ?? 0;
    if (c.clauseVersion > baseline) return ok;
    if (typeof ctx.payload.revisionNote === "string" && ctx.payload.revisionNote.trim().length >= 3) return ok;
    return fail("نسخه اصلاح‌شده بندها ثبت نشده است");
  },

  signatures_complete: (ctx) => {
    const required = ctx.runtime.requiredSignatures ?? [];
    const sigs = ctx.runtime.signatures ?? [];
    if (!required.length) return fail("طرفین امضا برای این قرارداد تعریف نشده است");
    const missing = required.filter((party) => {
      const s = sigs.find((x) => x.party === party);
      return !s || s.status !== "signed";
    });
    if (missing.length) return fail(`امضای ${missing.length} طرف باقی مانده است`);
    return ok;
  },

  tracking_required: (ctx) => {
    if (!ctx.runtime.requiresTracking) return fail("این پرونده «بدون کد رهگیری» ثبت شده است");
    return ok;
  },

  tracking_not_required: (ctx) => {
    if (ctx.runtime.requiresTracking) return fail("این پرونده نیازمند کد رهگیری است");
    return ok;
  },

  tracking_code_received: (ctx) => {
    const fromPayload = typeof ctx.payload.code === "string" ? ctx.payload.code.trim() : "";
    if (fromPayload) return ok;
    const t = ctx.runtime.tracking;
    if (!t || !t.code) return fail("کد رهگیری هنوز ثبت نشده است");
    if (t.status !== "received") return fail("وضعیت درخواست کد رهگیری «دریافت‌شده» نیست");
    return ok;
  },

  listing_finance_ok: (ctx) => {
    if (ctx.payload.__financeOverride === true) return ok;
    const l = ctx.runtime.listing;
    if (!l) return fail("پرونده آگهی یافت نشد");
    const payments = ctx.runtime.payments ?? [];
    if (payments.some((p) => p.status === "succeeded")) return ok;
    const sub = ctx.runtime.subscription;
    if (sub && sub.status === "active") {
      const scope = sub.scope ?? [];
      if (!scope.length || scope.includes(ctx.runtime.serviceKey) || scope.includes("listing") || scope.includes("*")) return ok;
    }
    const ref = ctx.runtime.referral;
    if (ref && ref.status === "approved") return ok;
    return fail("شرایط مالی آگهی (پرداخت، اشتراک معتبر یا معافیت) تأیید نشده است");
  },

  listing_data_complete: (ctx) => {
    const l = ctx.runtime.listing;
    if (!l) return fail("اطلاعات آگهی ثبت نشده است");
    if (!l.city || !l.district) return fail("شهر و محله ملک الزامی است");
    if (!l.area || l.area <= 0) return fail("متراژ ملک الزامی است");
    if (l.dealType === "sale" && num(l.price) === null) return fail("قیمت فروش الزامی است");
    if (l.dealType === "rent" && num(l.deposit) === null && num(l.rent) === null) return fail("ودیعه یا اجاره باید ثبت شود");
    if (!l.images?.length) return fail("حداقل یک تصویر برای آگهی لازم است");
    return ok;
  },

  listing_approved: (ctx) => {
    const decision = String(ctx.payload.decision ?? "");
    if (ctx.runtime.listing?.status === "published") return ok;
    return decision === "approved" ? ok : fail("نتیجه بررسی «تأیید» ثبت نشده است");
  },

  listing_expired: (ctx) => {
    const l = ctx.runtime.listing;
    if (!l?.expiresAt) return fail("تاریخ انقضا برای آگهی ثبت نشده است");
    return new Date(l.expiresAt).getTime() <= ctx.now.getTime() ? ok : fail("آگهی هنوز منقضی نشده است");
  },

  matches_found: (ctx) => {
    if (!(ctx.runtime.matches ?? []).length) return fail("هیچ آگهی متناسبی برای این نیازمندی پیدا نشد");
    return ok;
  },

  requirement_expired: (ctx) => {
    const r = ctx.runtime.requirement;
    if (!r?.expiresAt) return fail("تاریخ انقضا برای نیازمندی ثبت نشده است");
    return new Date(r.expiresAt).getTime() <= ctx.now.getTime() ? ok : fail("نیازمندی هنوز منقضی نشده است");
  },

  service_finance_ok: (ctx) => {
    if (ctx.payload.__financeOverride === true) return ok;
    const payments = ctx.runtime.payments ?? [];
    if (payments.some((p) => p.status === "succeeded")) return ok;
    const invoice = ctx.runtime.invoices?.[0];
    if (!invoice) return fail("فاکتور خدمت صادر نشده است");
    if (invoice.status === "paid") return ok;
    return fail("پرداخت این خدمت تکمیل نشده است");
  },

  service_approved: (ctx) => {
    const decision = String(ctx.payload.decision ?? "");
    return decision === "approved" ? ok : fail("تأیید نتیجه خدمت ثبت نشده است");
  },

  attempts_below_limit: (ctx) => {
    const counter = String(ctx.params.counter ?? "payment") as "payment" | "tracking" | "listing";
    const limit = Number(ctx.params.limit ?? 5);
    const attempts = ctx.runtime.attempts?.[counter] ?? 0;
    if (attempts >= limit) {
      return fail(`سقف تلاش مجاز (${limit}) برای این مرحله پر شده است؛ با مدیر تماس بگیرید`);
    }
    return ok;
  },

  report_decision: (ctx) => {
    const decision = String(ctx.payload.decision ?? "");
    const allowed = (ctx.params.allowed as string[] | undefined) ?? ["approved", "needs_fix", "rejected"];
    return allowed.includes(decision) ? ok : fail("نتیجه بررسی ثبت نشده است");
  },
};

export function createGuardRegistry(extra: Record<string, (ctx: GuardContext) => GuardResult> = {}): GuardRegistry {
  const map = { ...guards, ...extra };
  return {
    has: (key) => key in map,
    get: (key) => map[key],
    keys: () => Object.keys(map),
  };
}
