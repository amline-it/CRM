/**
 * افکت‌های نام‌دار — خروجی «نقشه اثر» برای ذخیره اتمی در لایه اپلیکیشن.
 * هر افکت فقط plan را تغییر می‌دهد؛ هیچ نوشتنی در حین ساخت نقشه انجام نمی‌شود.
 */
import type { EffectContext, EffectRegistry, Priority, RequirementRuntime } from "@/domain/engine/types";
import { addHours, toJalaliDateTime } from "@/lib/jalali";

/* ── عنوان رویدادها (فارسی) ───────────────────────────────────────── */

export const EVENT_TITLES: Record<string, string> = {
  "contract.type.rent": "نوع قرارداد: اجاره",
  "contract.type.sale": "نوع قرارداد: خرید و فروش",
  "contract.rent_info_submitted": "اطلاعات اجاره ثبت شد",
  "contract.sale_info_submitted": "اطلاعات خرید و فروش ثبت شد",
  "case.created": "پرونده خدمت تشکیل شد",
  "case.aborted": "پرونده منصرف شد",
  "finance.free": "خدمت بدون نیاز به پرداخت تأیید شد",
  "finance.payment.paid": "پرداخت با موفقیت انجام شد",
  "finance.payment.failed": "پرداخت ناموفق بود",
  "finance.payment.retry": "تلاش مجدد پرداخت",
  "finance.subscription.used": "از اشتراک معتبر استفاده شد",
  "finance.subscription.invalid": "اشتراک معتبر نبود؛ هدایت به پرداخت مستقیم",
  "finance.referral.approved": "ریفرال/معافیت تأیید شد",
  "finance.referral.rejected": "ریفرال/معافیت تأیید نشد؛ هدایت به پرداخت مستقیم",
  "documents.incomplete": "مدارک ناقص اعلام شد",
  "documents.rejected": "مدارک رد شد و درخواست اصلاح ثبت شد",
  "documents.resubmitted": "مدارک اصلاح و ارسال شد",
  "documents.pending": "مدارک در انتظار بررسی کارشناس",
  "documents.reviewed": "نتیجه بررسی مدارک ثبت شد",
  "documents.approved": "همه مدارک تأیید شد",
  "clause.no_edit_needed": "بدون نیاز به ویرایش بند",
  "clause.revised": "بندهای قرارداد اصلاح شد",
  "legal.review_started": "بررسی حقوقی انجام شد",
  "legal.approved": "بررسی حقوقی: تأیید",
  "legal.edit_requested": "بررسی حقوقی: نیاز به اصلاح بند",
  "legal.rejected": "بررسی حقوقی: رد قرارداد",
  "signature.sent": "قرارداد برای امضا ارسال شد",
  "signature.reminder": "یادآوری امضای باقی‌مانده",
  "signature.complete": "همه امضاها کامل شد",
  "tracking.requested": "درخواست کد رهگیری ارسال شد",
  "tracking.received": "کد رهگیری ثبت شد",
  "tracking.error": "خطا در دریافت کد رهگیری",
  "tracking.aborted": "از کد رهگیری انصراف داده شد",
  "contract.completed.signature_only": "قرارداد با امضا (بدون کد رهگیری) تکمیل شد",
  "contract.completed.with_tracking": "قرارداد با کد رهگیری تکمیل شد",
  "listing.finance_check": "بررسی شرایط مالی آگهی",
  "listing.finance_ok": "شرایط مالی آگهی تأیید شد",
  "listing.submitted": "آگهی برای بررسی ارسال شد",
  "listing.reviewed": "نتیجه بررسی آگهی ثبت شد",
  "listing.needs_fix": "آگهی نیازمند اصلاح است",
  "listing.resubmitted": "آگهی اصلاح و ارسال شد",
  "listing.published": "آگهی منتشر شد",
  "listing.paused": "انتشار آگهی موقتاً متوقف شد",
  "listing.resumed": "انتشار آگهی از سر گرفته شد",
  "listing.expired": "آگهی منقضی شد",
  "listing.closed": "آگهی بسته شد",
  "requirements.matching_started": "فرایند تطبیق نیازمندی آغاز شد",
  "requirements.matches_published": "پیشنهادهای متناسب ارائه شد",
  "requirements.reopened": "نیازمندی به حالت نمایش بازگشت",
  "requirements.fulfilled": "نیازمندی تأمین شد",
  "requirements.expired": "نیازمندی منقضی شد",
  "requirements.cancelled": "نیازمندی لغو شد",
  "service.info_submitted": "اطلاعات خدمت تکمیل شد",
  "service.finance_check": "بررسی شرایط مالی خدمت",
  "service.finance_ok": "شرایط مالی خدمت تأیید شد",
  "service.finance_failed": "خطای مالی خدمت",
  "service.executed": "اجرای خدمت اعلام شد",
  "service.delivered": "نتیجه خدمت تحویل شد",
  "service.needs_fix": "نتیجه خدمت نیازمند اصلاح است",
  "service.redo": "اصلاح و اجرای مجدد خدمت",
  "service.cancelled": "خدمت لغو شد",
  "crm.timeline": "ثبت رویداد CRM",
};

function eventTitle(kind: string, explicit?: unknown): string {
  if (typeof explicit === "string" && explicit.trim()) return explicit;
  return EVENT_TITLES[kind] ?? kind;
}

/* ── قالب پیام‌ها (فارسی) ─────────────────────────────────────────── */

function caseLabel(ctx: EffectContext): string {
  return ctx.runtime.code ?? ctx.runtime.caseId;
}

function contractParties(ctx: EffectContext): string {
  const c = ctx.runtime.contract;
  if (!c) return "";
  return c.contractType === "rent"
    ? `مالک: ${c.landlordName ?? "—"} / مستأجر: ${c.tenantName ?? "—"}`
    : `فروشنده: ${c.sellerName ?? "—"} / خریدار: ${c.buyerName ?? "—"}`;
}

export function renderTemplate(template: string, ctx: EffectContext): string {
  const code = caseLabel(ctx);
  switch (template) {
    case "payment_received":
      return `پرداخت خدمت با موفقیت انجام شد. شماره پرونده: ${code}`;
    case "documents_required":
      return `برای ادامه پرونده ${code}، مدارک موردنیاز را تکمیل و بارگذاری کنید.`;
    case "documents_rejected":
      return `برخی مدارک پرونده ${code} رد شده است؛ لطفاً اصلاح و ارسال مجدد کنید.`;
    case "contract_rejected":
      return `قرارداد پرونده ${code} در بررسی حقوقی رد شد. ${ctx.reason ? `دلیل: ${ctx.reason}` : ""}`;
    case "signature_request":
      return `قرارداد پرونده ${code} آماده امضاست. لطفاً برای امضا اقدام کنید. ${contractParties(ctx)}`;
    case "signature_reminder":
      return `یادآوری: امضای پرونده ${code} هنوز کامل نشده است.`;
    case "tracking_code_issued":
      return `کد رهگیری پرونده ${code} صادر شد: ${ctx.runtime.tracking?.code ?? "—"}`;
    case "listing_needs_fix":
      return `آگهی شما نیازمند اصلاح است. ${ctx.reason ? `دلیل: ${ctx.reason}` : ""}`;
    case "listing_published":
      return `آگهی شما منتشر شد. کد آگهی: ${ctx.runtime.listing?.id ?? "—"}`;
    case "requirement_matches":
      return `برای نیازمندی شما ${ctx.runtime.matches.length} پیشنهاد مناسب پیدا شد.`;
    case "service_delivered":
      return `نتیجه خدمت پرونده ${code} تحویل شد.`;
    default:
      return `به‌روزرسانی پرونده ${code}: ${template}`;
  }
}

/* ── افکت‌ها ──────────────────────────────────────────────────────── */

const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

export const effects: Record<string, (ctx: EffectContext) => void> = {
  record_event: (ctx) => {
    const kind = String(ctx.params.kind ?? "crm.timeline");
    ctx.plan.events.push({
      kind,
      title: eventTitle(kind, ctx.params.title),
      body: typeof ctx.params.body === "string" ? ctx.params.body : buildEventBody(ctx, kind),
      visibility: ctx.params.visibility === "external" ? "external" : "internal",
      actorId: ctx.actor.id ?? null,
      actorName: ctx.actor.name ?? null,
      at: ctx.now.toISOString(),
      meta: { transition: ctx.transition.key, option: ctx.option?.value ?? null },
    });
  },

  create_followup_task: (ctx) => {
    if (ctx.params.when === "needsFollowup" && ctx.payload.needsFollowup === false) return;
    const title = String(ctx.params.title ?? "پیگیری پرونده");
    const rawPriority = String(ctx.params.priority ?? "");
    const priority = (PRIORITIES as string[]).includes(rawPriority) ? (rawPriority as Priority) : "normal";
    const dueInHours = Number(ctx.params.dueInHours ?? 24);
    ctx.plan.tasks.push({
      title,
      description: typeof ctx.params.description === "string" ? ctx.params.description : null,
      priority,
      dueAt: addHours(ctx.now, dueInHours).toISOString(),
      assigneeId: (typeof ctx.params.assigneeId === "string" ? ctx.params.assigneeId : ctx.runtime.assignedStaffId) ?? null,
      dedupeKey: `${ctx.runtime.caseId}:${ctx.transition.key}:${title}`,
    });
  },

  update_followup_task: (ctx) => {
    ctx.plan.taskUpdates.push({
      taskId: ctx.runtime.openTaskId ?? null,
      markDone: ctx.params.markDone !== false,
      resultNote: typeof ctx.payload.taskResult === "string" ? ctx.payload.taskResult : null,
      rescheduleHours: typeof ctx.params.rescheduleHours === "number" ? ctx.params.rescheduleHours : null,
    });
  },

  notify_parties: (ctx) => {
    const template = String(ctx.params.template ?? "generic");
    const channel = (ctx.params.channel as "sms" | "email" | "inapp") ?? "sms";
    ctx.plan.notifications.push({
      channel,
      template,
      toUserId: ctx.runtime.ownerUserId ?? null,
      body: renderTemplate(template, ctx),
    });
  },

  queue_for_expert: (ctx) => {
    const queue = String(ctx.params.queue ?? "general");
    ctx.plan.casePatch.serviceData = { ...(ctx.plan.casePatch.serviceData ?? {}), queue };
    if (!ctx.plan.casePatch.assignedStaffId) {
      ctx.plan.casePatch.assignedStaffId = ctx.runtime.assignedStaffId ?? null;
    }
  },

  assign_case_code: (ctx) => {
    if (ctx.runtime.code) return;
    const next = ctx.settings.nextCaseCode;
    if (typeof next === "string" && next) ctx.plan.casePatch.code = next;
    else ctx.plan.warnings.push("شماره پرونده از تنظیمات اپلیکیشن تعیین نشد؛ پس از ثبت، شماره خودکار تولید می‌شود");
  },

  set_requires_tracking: (ctx) => {
    ctx.plan.casePatch.requiresTracking = ctx.params.value === true;
  },

  set_requirement_status: (ctx) => {
    const status = String(ctx.params.status ?? "open") as RequirementRuntime["status"];
    ctx.plan.casePatch.requirementPatch = { ...(ctx.plan.casePatch.requirementPatch ?? {}), status };
  },

  set_access_level: (ctx) => {
    const level = String(ctx.params.level ?? "staff");
    ctx.plan.casePatch.accessLevel = level;
    ctx.plan.casePatch.requirementPatch = { accessLevel: level as "public" | "agents" | "staff" };
  },

  increment_attempt: (ctx) => {
    const counter = String(ctx.params.counter ?? "payment") as "payment" | "tracking" | "listing";
    const current = ctx.runtime.attempts?.[counter] ?? 0;
    ctx.plan.casePatch.attempts = { ...(ctx.plan.casePatch.attempts ?? {}), [counter]: current + 1 };
  },

  close_case: (ctx) => {
    const outcome = String(ctx.params.outcome ?? "completed");
    ctx.plan.casePatch.status = "closed";
    ctx.plan.casePatch.outcome = outcome;
    ctx.plan.outbound.push({
      event: `case.${outcome}`,
      payload: { caseId: ctx.runtime.caseId, code: ctx.runtime.code ?? null, outcome, at: ctx.now.toISOString() },
    });
  },

  set_priority: (ctx) => {
    const value = String(ctx.params.value ?? "normal") as Priority;
    if (PRIORITIES.includes(value)) ctx.plan.casePatch.priority = value;
  },

  set_due: (ctx) => {
    const hours = Number(ctx.params.hours ?? 24);
    ctx.plan.casePatch.dueAt = addHours(ctx.now, hours).toISOString();
  },

  generate_contract_document: (ctx) => {
    const c = ctx.runtime.contract;
    if (!c) {
      ctx.plan.warnings.push("تولید سند قرارداد بدون اطلاعات قرارداد ثبت شد");
      return;
    }
    ctx.plan.casePatch.contractPatch = { ...(ctx.plan.casePatch.contractPatch ?? {}), documentGeneratedAt: ctx.now.toISOString() };
    ctx.plan.events.push({
      kind: "contract.document.generated",
      title: "سند قرارداد تولید شد",
      body: `سند ${c.contractType === "rent" ? "اجاره" : "خرید و فروش"} برای پرونده ${caseLabel(ctx)} آماده شد.`,
      visibility: "external",
      actorId: ctx.actor.id ?? null,
      actorName: ctx.actor.name ?? null,
      at: ctx.now.toISOString(),
    });
  },

  bump_clause_version: (ctx) => {
    const c = ctx.runtime.contract;
    const next = (c?.clauseVersion ?? 0) + 1;
    ctx.plan.casePatch.contractPatch = {
      ...(ctx.plan.casePatch.contractPatch ?? {}),
      clauseVersion: next,
      termsNote: typeof ctx.payload.revisionNote === "string" ? ctx.payload.revisionNote : c?.termsNote ?? null,
    };
  },

  record_legal_review: (ctx) => {
    const result = (ctx.payload.decision ?? ctx.params.result) as "approved" | "needs_edit" | "rejected";
    if (!result) {
      ctx.plan.warnings.push("نتیجه بررسی حقوقی ثبت نشد");
      return;
    }
    ctx.plan.casePatch.legalReview = {
      result,
      note: typeof ctx.payload.note === "string" ? ctx.payload.note : (ctx.reason ?? null),
      clauseVersionAtReview: ctx.runtime.contract?.clauseVersion ?? null,
    };
  },

  send_for_signature: (ctx) => {
    const required = ctx.runtime.requiredSignatures ?? [];
    const existing = new Set(ctx.runtime.signatures.map((s) => s.party));
    for (const party of required) {
      if (existing.has(party)) continue;
      ctx.plan.signatures.push({ party, partyName: partyName(ctx, party), status: "pending", method: "in_person" });
    }
  },

  consume_referral: (ctx) => {
    ctx.plan.casePatch.referralUse = { consume: true, code: ctx.runtime.referral?.code };
  },

  emit_invoice: (ctx) => {
    if (!ctx.settings.serviceRequiresPayment) return;
    if (ctx.runtime.invoices.length) return;
    const amount = Number(ctx.settings.servicePrice ?? 0);
    ctx.plan.invoice = {
      title: String(ctx.settings.serviceName ?? "خدمت"),
      amount,
      status: "unpaid",
      method: "direct",
    };
    ctx.plan.outbound.push({
      event: "invoice.issued",
      payload: { caseId: ctx.runtime.caseId, amount, at: ctx.now.toISOString() },
    });
  },

  record_tracking_code: (ctx) => {
    const code = String(ctx.payload.code ?? "").trim();
    if (!code) {
      ctx.plan.warnings.push("کد رهگیری خالی بود");
      return;
    }
    ctx.plan.trackingRequest = { status: "received", code, error: null };
  },

  record_tracking_error: (ctx) => {
    ctx.plan.trackingRequest = { status: "error", code: null, error: ctx.reason ?? "خطای نامشخص در دریافت کد رهگیری" };
  },

  request_tracking_code: (ctx) => {
    ctx.plan.trackingRequest = { status: "requested", code: null, error: null };
    ctx.plan.outbound.push({
      event: "tracking.requested",
      payload: {
        caseId: ctx.runtime.caseId,
        code: ctx.runtime.code ?? null,
        contractType: ctx.runtime.contract?.contractType ?? null,
        parties: contractParties(ctx),
        at: ctx.now.toISOString(),
      },
    });
  },

  publish_listing: (ctx) => {
    const days = Number(ctx.settings.listingDurationDays ?? 30);
    ctx.plan.casePatch.listingPatch = {
      status: "published",
      publishedAt: ctx.now.toISOString(),
      expiresAt: addHours(ctx.now, days * 24).toISOString(),
    };
    ctx.plan.outbound.push({
      event: "listing.published",
      payload: { caseId: ctx.runtime.caseId, listingId: ctx.runtime.listing?.id ?? null, at: ctx.now.toISOString() },
    });
  },

  unpublish_listing: (ctx) => {
    const reason = String(ctx.params.reason ?? "paused") as "paused" | "expired" | "closed";
    ctx.plan.casePatch.listingPatch = { status: reason === "expired" ? "expired" : reason === "closed" ? "closed" : "paused" };
    ctx.plan.outbound.push({
      event: "listing.unpublished",
      payload: { caseId: ctx.runtime.caseId, listingId: ctx.runtime.listing?.id ?? null, reason, at: ctx.now.toISOString() },
    });
  },

  emit_webhook: (ctx) => {
    const event = String(ctx.params.event ?? "case.updated");
    ctx.plan.outbound.push({
      event,
      payload: { caseId: ctx.runtime.caseId, code: ctx.runtime.code ?? null, at: ctx.now.toISOString() },
    });
  },
};

function partyName(ctx: EffectContext, party: string): string | null {
  const c = ctx.runtime.contract;
  if (!c) return null;
  switch (party) {
    case "landlord": return c.landlordName ?? null;
    case "tenant": return c.tenantName ?? null;
    case "seller": return c.sellerName ?? null;
    case "buyer": return c.buyerName ?? null;
    default: return null;
  }
}

function buildEventBody(ctx: EffectContext, kind: string): string {
  const at = toJalaliDateTime(ctx.now);
  if (kind.startsWith("legal.") && ctx.reason) return `${at} — دلیل: ${ctx.reason}`;
  if (kind.startsWith("documents.") && ctx.reason) return `${at} — توضیح: ${ctx.reason}`;
  if (kind === "case.created") return `${at} — پرونده برای خدمت «${ctx.runtime.serviceKey}» تشکیل شد.`;
  return `${at} — گذار «${ctx.transition.name}» توسط ${ctx.actor.name ?? ctx.actor.type}`;
}

export function createEffectRegistry(extra: Record<string, (ctx: EffectContext) => void> = {}): EffectRegistry {
  const map = { ...effects, ...extra };
  return {
    has: (key) => key in map,
    get: (key) => map[key],
    keys: () => Object.keys(map),
  };
}
