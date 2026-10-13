/**
 * لایه سرویس پرونده — پل بین موتور خالص و دیتابیس.
 * بارگذاری «وضعیت جهان»، اجرای نقشه اثر موتور، و ذخیره اتمی در یک تراکنش.
 */
import { AppError } from "@/lib/errors";
import { buildCaseCode, newId } from "@/lib/ids";
import { toJalaliParts } from "@/lib/jalali";
import { jsonParse, transaction, nowIso } from "@/db/client";
import * as Cases from "@/db/repos/cases";
import * as Catalog from "@/db/repos/catalog";
import * as Finance from "@/db/repos/finance";
import * as People from "@/db/repos/people";
import * as Platform from "@/db/repos/platform";
import { loadDefinition, guards, effects, buildEngine } from "@/domain/workflows";
import { notificationProvider, paymentProvider, trackingProvider } from "@/domain/adapters";
import type {
  ActorContext,
  ApplyPlan,
  CaseRuntime,
  ContractRuntime,
  DocumentRuntime,
  EngineDeps,
  LegalReviewRuntime,
  ListingRuntime,
  MatchRuntime,
  PaymentRuntime,
  Priority,
  RequirementRuntime,
  SignatureRuntime,
  SubscriptionRuntime,
  TrackingRuntime,
} from "@/domain/engine/types";

export interface ApplyTransitionOptions {
  caseId: string;
  transitionKey: string;
  option?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown>;
  actor: ActorContext;
  idempotencyKey?: string | null;
  ip?: string | null;
}

export interface ApplyTransitionResult {
  caseId: string;
  from: string;
  to: string;
  transitionKey: string;
  plan: ApplyPlan;
  runtime: CaseRuntime;
}

const deps: EngineDeps = { guards, effects };

/* ── بارگذاری وضعیت جهان ─────────────────────────────────────────── */

export function buildSettings(service: Catalog.ServiceRow | null, caseId?: string): Record<string, unknown> {
  const sequence = Cases.nextCaseSequence();
  const jy = toJalaliParts(new Date()).jy;
  return {
    serviceName: service?.name ?? "خدمت",
    servicePrice: service?.price ?? 0,
    serviceRequiresPayment: (service?.price ?? 0) > 0,
    requiresSubscription: Boolean(service?.requires_subscription),
    listingDurationDays: Platform.getSetting<number>("listing.durationDays", 30),
    nextCaseCode: buildCaseCode(sequence, jy),
    caseId: caseId ?? null,
  };
}

export function loadRuntime(caseId: string): CaseRuntime {
  const row = Cases.findCaseById(caseId);
  if (!row) throw new AppError("NOT_FOUND", `پرونده ${caseId} یافت نشد`);
  const service = Catalog.getServiceByKey(row.service_key);
  const contract = Cases.findContractByCase(caseId);
  const legal = Cases.latestLegalReview(caseId);
  const tracking = Cases.findTracking(caseId);
  const listing = Catalog.findListingByCase(caseId);
  const requirement = Catalog.findRequirementByCase(caseId);
  const subscription = Finance.activeSubscriptionFor(row.owner_user_id, row.service_key);
  const referral = Finance.referralForCase(caseId);

  const contractRuntime: ContractRuntime | null = contract
    ? {
        contractType: contract.contract_type,
        outputMode: contract.output_mode,
        propertyAddress: contract.property_address,
        city: contract.city,
        district: contract.district,
        area: contract.area,
        landlordName: contract.landlord_name,
        tenantName: contract.tenant_name,
        sellerName: contract.seller_name,
        buyerName: contract.buyer_name,
        depositAmount: contract.deposit_amount,
        rentAmount: contract.rent_amount,
        salePrice: contract.sale_price,
        startDate: contract.start_date,
        endDate: contract.end_date,
        termsNote: contract.terms_note,
        clauseVersion: contract.clause_version,
        documentGeneratedAt: contract.document_generated_at,
      }
    : null;

  const legalRuntime: LegalReviewRuntime | null = legal
    ? { result: legal.result, note: legal.note, clauseVersionAtReview: legal.clause_version_at_review }
    : null;

  const trackingRuntime: TrackingRuntime | null = tracking
    ? { status: tracking.status, code: tracking.code, error: tracking.error, attempts: tracking.attempts }
    : null;

  const listingRuntime: ListingRuntime | null = listing
    ? {
        id: listing.id,
        dealType: listing.deal_type,
        propertyType: listing.property_type,
        city: listing.city,
        district: listing.district,
        address: listing.address,
        area: listing.area,
        rooms: listing.rooms,
        price: listing.price,
        deposit: listing.deposit,
        rent: listing.rent,
        description: listing.description,
        images: jsonParse<string[]>(listing.images, []),
        status: listing.status,
        expiresAt: listing.expires_at,
      }
    : null;

  const requirementRuntime: RequirementRuntime | null = requirement
    ? {
        id: requirement.id,
        dealType: requirement.deal_type,
        propertyType: requirement.property_type,
        city: requirement.city,
        districts: jsonParse<string[]>(requirement.districts, []),
        budgetMin: requirement.budget_min,
        budgetMax: requirement.budget_max,
        areaMin: requirement.area_min,
        areaMax: requirement.area_max,
        rooms: requirement.rooms,
        accessLevel: requirement.access_level,
        status: requirement.status,
        expiresAt: requirement.expires_at,
      }
    : null;

  const matches: MatchRuntime[] = requirement
    ? Catalog.listMatches(requirement.id).map((m) => ({ id: m.id, listingId: m.listing_id, score: m.score }))
    : [];

  const documents: DocumentRuntime[] = Cases.listDocuments(caseId).map((d) => ({
    id: d.id,
    kind: d.kind,
    title: d.title,
    status: d.status,
  }));

  const signatures: SignatureRuntime[] = Cases.listSignatures(caseId).map((s) => ({
    id: s.id,
    party: s.party,
    partyName: s.party_name,
    status: s.status,
    method: s.method,
  }));

  const payments: PaymentRuntime[] = Finance.listPayments(caseId).map((p) => ({
    id: p.id,
    method: p.method,
    status: p.status,
    amount: p.amount,
  }));

  const invoices = Finance.listInvoices(caseId).map((i) => ({ id: i.id, status: i.status, amount: i.amount }));

  const subscriptionRuntime: SubscriptionRuntime | null = subscription
    ? {
        id: subscription.id,
        status: subscription.status,
        scope: jsonParse<string[]>(subscription.scope, []),
        endsAt: subscription.ends_at,
      }
    : null;

  const openTask = Cases.listTasks({ caseId, status: ["open", "in_progress"], limit: 1 })[0];

  return {
    caseId: row.id,
    code: row.code,
    serviceKey: row.service_key,
    workflowKey: row.workflow_key,
    workflowVersion: row.workflow_version,
    state: row.state,
    status: row.status,
    outcome: row.outcome,
    priority: row.priority,
    dueAt: row.due_at,
    requiresTracking: Boolean(row.requires_tracking),
    attempts: { payment: row.attempts_payment, tracking: row.attempts_tracking },
    accessLevel: row.access_level,
    assignedStaffId: row.assigned_staff_id,
    ownerUserId: row.owner_user_id,
    agentUserId: row.agent_user_id,
    contract: contractRuntime,
    documents,
    requiredDocuments: service ? jsonParse<string[]>(service.required_documents, []) : [],
    legalReview: legalRuntime,
    signatures,
    requiredSignatures: requiredSignaturesFor(contractRuntime),
    tracking: trackingRuntime,
    payments,
    invoices,
    subscription: subscriptionRuntime,
    referral: referral
      ? {
          id: referral.id,
          code: referral.code,
          kind: referral.kind,
          status: referral.active ? "approved" : "rejected",
          scope: jsonParse<string[]>(referral.scope, []),
        }
      : null,
    listing: listingRuntime,
    requirement: requirementRuntime,
    matches,
    openTaskId: openTask?.id ?? null,
    now: nowIso(),
    settings: { ...buildSettings(service, caseId), queue: row.queue },
  };
}

export function requiredSignaturesFor(contract: ContractRuntime | null): string[] {
  if (!contract) return [];
  return contract.contractType === "rent" ? ["landlord", "tenant"] : ["seller", "buyer"];
}

/* ── ساخت پرونده ─────────────────────────────────────────────────── */

export interface CreateCaseInput {
  serviceKey: string;
  ownerUserId?: string | null;
  agentUserId?: string | null;
  assignedStaffId?: string | null;
  externalId?: string | null;
  source?: string | null;
  title?: string | null;
  priority?: Priority;
  submission?: Record<string, unknown>;
}

export function createCase(input: CreateCaseInput): { caseId: string } {
  const service = Catalog.getServiceByKey(input.serviceKey);
  if (!service) throw new AppError("NOT_FOUND", `خدمت ${input.serviceKey} تعریف نشده است`);
  const definition = loadDefinition(service.workflow_key, 1);
  const caseId = newId("case");
  const sequence = Cases.nextCaseSequence();
  const code = buildCaseCode(sequence, toJalaliParts(new Date()).jy);

  transaction(() => {
    Cases.createCase({
      id: caseId,
      code,
      externalId: input.externalId ?? null,
      source: input.source ?? null,
      title: input.title ?? service.name,
      serviceKey: service.key,
      workflowKey: service.workflow_key,
      workflowVersion: definition.version,
      state: definition.initial,
      priority: input.priority ?? "normal",
      ownerUserId: input.ownerUserId ?? null,
      agentUserId: input.agentUserId ?? null,
      assignedStaffId: input.assignedStaffId ?? null,
      requiresTracking: false,
    });
    // مدارک لازم برای خدمت
    const required = jsonParse<string[]>(service.required_documents, []);
    required.forEach((kind, index) => {
      Cases.upsertDocument({
        caseId,
        kind,
        title: documentTitle(kind),
        status: "pending",
        note: index === 0 ? "در انتظار بارگذاری" : null,
      });
    });
    // پوسته موجودیت مرتبط
    if (service.category === "listing") {
      Catalog.createListing({ caseId, deal_type: "rent", property_type: "آپارتمان", status: "draft" });
      const listing = Catalog.findListingByCase(caseId);
      if (listing) Catalog.updateListing(listing.id, { owner_user_id: input.ownerUserId ?? null, agent_user_id: input.agentUserId ?? null });
    }
    if (service.category === "requirements") {
      Catalog.createRequirement({ caseId, requesterUserId: input.ownerUserId ?? null, access_level: "staff" });
    }
    if (service.category === "contract") {
      Cases.upsertContract(caseId, {
        contract_type: "rent",
        output_mode: "signature_only",
      });
    }
    Cases.insertTimelineEvent({
      caseId,
      kind: "case.opened",
      title: "پرونده ایجاد شد",
      body: `پرونده «${service.name}» با شماره ${code} ثبت شد.`,
      actorName: "کارمند",
      at: nowIso(),
    });
  });

  return { caseId };
}

export function documentTitle(kind: string): string {
  const titles: Record<string, string> = {
    ownership: "سند مالکیت",
    national_id: "کارت ملی",
    contract_draft: "پیش‌نویس قرارداد",
    property_image: "تصویر ملک",
    deed: "سند تک‌برگ",
    id_card: "کارت ملی مالک",
    postal_code: "کد پستی ملک",
    power_of_attorney: "وکالت‌نامه",
    commitment: "تعهدنامه",
  };
  return titles[kind] ?? kind;
}

/* ── اجرای گذار و ذخیره نقشه اثر ──────────────────────────────────── */

export function applyTransition(opts: ApplyTransitionOptions): ApplyTransitionResult {
  const runtime = loadRuntime(opts.caseId);

  if (opts.idempotencyKey) {
    const previous = Platform.getIdempotentResponse(`transition:${opts.caseId}:${opts.idempotencyKey}`);
    if (previous) {
      const row = Cases.findCaseById(opts.caseId);
      return {
        caseId: opts.caseId,
        from: runtime.state,
        to: row?.state ?? runtime.state,
        transitionKey: opts.transitionKey,
        plan: jsonParse<ApplyPlan>(previous.response, {} as ApplyPlan),
        runtime: loadRuntime(opts.caseId),
      };
    }
  }

  const engine = buildEngine(loadDefinition(runtime.workflowKey, runtime.workflowVersion));
  const plan = engine.plan({
    runtime,
    transitionKey: opts.transitionKey,
    option: opts.option ?? null,
    actor: opts.actor,
    reason: opts.reason ?? null,
    payload: opts.payload ?? {},
    triggerEvent: (opts.payload?.__triggerEvent as string | undefined) ?? null,
  });

  transaction(() => {
    persistPlan(plan, runtime, opts);
    if (opts.idempotencyKey) {
      Platform.saveIdempotentResponse(
        `transition:${opts.caseId}:${opts.idempotencyKey}`,
        "transition",
        200,
        plan,
      );
    }
    Platform.writeAudit({
      actorType: opts.actor.type,
      actorId: opts.actor.id ?? null,
      actorName: opts.actor.name ?? null,
      action: `case.transition.${plan.transitionKey}`,
      entityType: "case",
      entityId: opts.caseId,
      detail: { from: plan.from, to: plan.to, option: plan.option, reason: opts.reason ?? null },
      ip: opts.ip ?? null,
    });
  });

  // اعلان‌ها بعد از تراکنش (شکست پیام نباید گذار را برگرداند)
  for (const notification of plan.notifications) {
    try {
      const result = notificationProvider().send({
        channel: notification.channel,
        to: notification.toAddress ?? null,
        body: notification.body,
        template: notification.template,
      });
      const id = Platform.insertNotification({
        channel: notification.channel,
        template: notification.template,
        toUserId: notification.toUserId ?? null,
        toAddress: notification.toAddress ?? null,
        caseId: opts.caseId,
        body: notification.body,
      });
      Platform.markNotification(id, result.status, result.provider, result.error ?? undefined);
    } catch (err) {
      const id = Platform.insertNotification({
        channel: notification.channel,
        template: notification.template,
        caseId: opts.caseId,
        body: notification.body,
      });
      Platform.markNotification(id, "failed", undefined, err instanceof Error ? err.message : String(err));
    }
  }

  return {
    caseId: opts.caseId,
    from: plan.from,
    to: plan.to,
    transitionKey: plan.transitionKey,
    plan,
    runtime: loadRuntime(opts.caseId),
  };
}

function persistPlan(plan: ApplyPlan, runtime: CaseRuntime, opts: ApplyTransitionOptions): void {
  const patch = plan.casePatch;
  const casePatch: Record<string, unknown> = {
    state: plan.to,
    last_transition_at: plan.at,
  };
  if (patch.code !== undefined) casePatch.code = patch.code;
  if (patch.status !== undefined) {
    casePatch.status = patch.status;
    if (patch.status === "closed") casePatch.closed_at = plan.at;
  }
  if (patch.outcome !== undefined) casePatch.outcome = patch.outcome;
  if (patch.priority !== undefined) casePatch.priority = patch.priority;
  if (patch.dueAt !== undefined) casePatch.due_at = patch.dueAt;
  if (patch.requiresTracking !== undefined) casePatch.requires_tracking = patch.requiresTracking ? 1 : 0;
  if (patch.accessLevel !== undefined) casePatch.access_level = patch.accessLevel;
  if (patch.assignedStaffId !== undefined) casePatch.assigned_staff_id = patch.assignedStaffId;
  if (patch.attempts?.payment !== undefined) casePatch.attempts_payment = patch.attempts.payment;
  if (patch.attempts?.tracking !== undefined) casePatch.attempts_tracking = patch.attempts.tracking;
  if (patch.serviceData?.queue !== undefined) casePatch.queue = patch.serviceData.queue;
  else if (plan.to.includes("queue") || plan.transitionKey.startsWith("queue_for")) casePatch.queue = plan.to;
  Cases.updateCase(plan.caseId, casePatch);

  Cases.insertTransition({
    case_id: plan.caseId,
    from_state: plan.from,
    to_state: plan.to,
    transition_key: plan.transitionKey,
    transition_name: plan.transitionName,
    option: plan.option ?? null,
    actor_type: plan.actor.type,
    actor_id: plan.actor.id ?? null,
    actor_name: plan.actor.name ?? null,
    reason: plan.reason ?? null,
    payload: JSON.stringify(opts.payload ?? {}),
    idempotency_key: opts.idempotencyKey ?? null,
    at: plan.at,
  });

  if (patch.contractPatch) {
    Cases.patchContract(plan.caseId, sanitizeContractPatch(patch.contractPatch));
  }
  if (patch.legalReview) {
    Cases.insertLegalReview({
      caseId: plan.caseId,
      reviewerId: opts.actor.id ?? null,
      result: patch.legalReview.result,
      note: patch.legalReview.note ?? null,
      clauseVersionAtReview: patch.legalReview.clauseVersionAtReview ?? null,
    });
  }
  if (patch.referralUse?.consume && runtime.referral) {
    Finance.useReferral(runtime.referral.id, plan.caseId, opts.actor.id ?? null);
  }

  for (const event of plan.events) {
    Cases.insertTimelineEvent({
      caseId: plan.caseId,
      kind: event.kind,
      title: event.title,
      body: event.body ?? null,
      visibility: event.visibility ?? "internal",
      actorId: event.actorId ?? null,
      actorName: event.actorName ?? null,
      at: event.at,
      meta: event.meta ?? null,
    });
  }

  for (const task of plan.tasks) {
    Cases.createTask({
      caseId: plan.caseId,
      title: task.title,
      description: task.description ?? null,
      priority: task.priority,
      assigneeId: task.assigneeId ?? runtime.assignedStaffId ?? null,
      dueAt: task.dueAt,
      createdBy: opts.actor.id ?? null,
      dedupeKey: task.dedupeKey ?? null,
    });
  }

  for (const update of plan.taskUpdates) {
    const taskId = update.taskId ?? runtime.openTaskId;
    if (!taskId) continue;
    if (update.markDone) {
      Cases.updateTask(taskId, { status: "done", result_note: update.resultNote ?? null });
    } else if (update.rescheduleHours) {
      Cases.updateTask(taskId, { due_at: new Date(Date.now() + update.rescheduleHours * 3_600_000).toISOString() });
    }
  }

  for (const signature of plan.signatures) {
    Cases.upsertSignature({
      caseId: plan.caseId,
      party: signature.party,
      partyName: signature.partyName ?? null,
      status: signature.status,
      method: signature.method ?? null,
    });
  }

  if (plan.trackingRequest) {
    // شمارنده تلاش‌ها یک منبع حقیقت دارد: case.attempts.tracking که افکت increment_attempt می‌سازد
    Cases.upsertTracking(plan.caseId, {
      status: plan.trackingRequest.status,
      code: plan.trackingRequest.code ?? null,
      error: plan.trackingRequest.error ?? null,
      attempts: patch.attempts?.tracking,
    });
  }

  if (plan.invoice) {
    Finance.createInvoice({ caseId: plan.caseId, title: plan.invoice.title, amount: plan.invoice.amount, method: plan.invoice.method });
  }
  if (plan.payment) {
    Finance.createPayment({
      caseId: plan.caseId,
      method: plan.payment.method,
      amount: plan.payment.amount,
      status: plan.payment.status,
      provider: plan.payment.provider ?? null,
      providerRef: plan.payment.providerRef ?? null,
      error: plan.payment.error ?? null,
    });
  }
  if (patch.listingPatch) {
    const listing = Catalog.findListingByCase(plan.caseId);
    if (listing) Catalog.updateListing(listing.id, sanitizeListingPatch(patch.listingPatch));
  }
  if (patch.requirementPatch) {
    const requirement = Catalog.findRequirementByCase(plan.caseId);
    if (requirement) Catalog.updateRequirement(requirement.id, sanitizeRequirementPatch(patch.requirementPatch));
  }

  const targetUrl = Platform.getSetting<string>("sync.webhookUrl", process.env.WEBHOOK_TARGET_URL ?? "");
  for (const outbound of plan.outbound) {
    Platform.enqueueWebhook(outbound.event, outbound.payload, targetUrl || null, plan.caseId);
  }
}

function sanitizeContractPatch(patch: Partial<ContractRuntime>): Record<string, unknown> {
  const map: Record<string, string> = {
    contractType: "contract_type",
    outputMode: "output_mode",
    propertyAddress: "property_address",
    city: "city",
    district: "district",
    area: "area",
    landlordName: "landlord_name",
    tenantName: "tenant_name",
    sellerName: "seller_name",
    buyerName: "buyer_name",
    depositAmount: "deposit_amount",
    rentAmount: "rent_amount",
    salePrice: "sale_price",
    startDate: "start_date",
    endDate: "end_date",
    termsNote: "terms_note",
    clauseVersion: "clause_version",
    documentGeneratedAt: "document_generated_at",
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const column = map[key];
    if (column && value !== undefined) out[column] = value;
  }
  return out;
}

function sanitizeListingPatch(patch: NonNullable<ApplyPlan["casePatch"]["listingPatch"]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.status) out.status = patch.status;
  if (patch.publishedAt !== undefined) out.published_at = patch.publishedAt;
  if (patch.expiresAt !== undefined) out.expires_at = patch.expiresAt;
  return out;
}

function sanitizeRequirementPatch(patch: NonNullable<ApplyPlan["casePatch"]["requirementPatch"]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.status) out.status = patch.status;
  if (patch.accessLevel) out.access_level = patch.accessLevel;
  return out;
}

/* ── کنش‌های دامنه‌ای (سرور-ساید) ─────────────────────────────────── */

/** حالت‌هایی که در آن‌ها ثبت نتیجه پرداخت به‌صورت خودکار پرونده را پیش می‌برد */
const PAYMENT_ADVANCE: Record<string, { succeeded: string; failed: string }> = {
  payment_direct: { succeeded: "payment_succeeded", failed: "payment_failed" },
  payment_error: { succeeded: "payment_succeeded", failed: "payment_failed" },
  service_finance: { succeeded: "service_finance_ok", failed: "service_finance_failed" },
};

export function recordPaymentAttempt(opts: {
  caseId: string;
  method: "direct" | "subscription" | "referral" | "free";
  simulateFailure?: boolean;
  actor: ActorContext;
}): { paymentId: string; status: "succeeded" | "failed"; advancedTo: string | null } {
  const runtime = loadRuntime(opts.caseId);
  const invoice = runtime.invoices[0];
  const amount = invoice?.amount ?? (runtime.settings.servicePrice as number) ?? 0;
  const provider = paymentProvider();
  const isSandbox = provider instanceof Object && provider.name === "sandbox";
  const result = opts.simulateFailure
    ? isSandbox
      ? { status: "failed" as const, provider: "sandbox", providerRef: null, error: "پرداخت ناموفق (شبیه‌سازی)" }
      : provider.charge({ caseId: opts.caseId, amount, method: opts.method })
    : provider.charge({ caseId: opts.caseId, amount, method: opts.method });

  const paymentId = transaction(() =>
    Finance.createPayment({
      caseId: opts.caseId,
      invoiceId: invoice?.id ?? null,
      method: opts.method,
      amount,
      status: result.status === "succeeded" ? "succeeded" : "failed",
      provider: result.provider,
      providerRef: result.providerRef,
      error: "error" in result ? result.error ?? null : null,
      attempt: runtime.attempts.payment + 1,
    }),
  );
  if (result.status === "succeeded" && invoice) Finance.markInvoicePaid(invoice.id, opts.method);
  Platform.writeAudit({
    actorType: opts.actor.type,
    actorId: opts.actor.id ?? null,
    actorName: opts.actor.name ?? null,
    action: result.status === "succeeded" ? "payment.succeeded" : "payment.failed",
    entityType: "case",
    entityId: opts.caseId,
    detail: { paymentId, amount, provider: result.provider },
  });

  // نتیجه پرداخت باید پرونده را پیش ببرد (گذارهای خودکار موتور)
  const status = result.status === "succeeded" ? "succeeded" : "failed";
  let advancedTo: string | null = null;
  const advance = PAYMENT_ADVANCE[runtime.state];
  if (advance) {
    const transitionKey = status === "succeeded" ? advance.succeeded : advance.failed;
    try {
      const applied = applyTransition({
        caseId: opts.caseId,
        transitionKey,
        actor: { type: "system", name: "سامانه" },
        payload: { paymentResult: status, paymentId },
      });
      advancedTo = applied.to;
    } catch (err) {
      Platform.writeAudit({
        actorType: "system",
        actorName: "سامانه",
        action: "payment.advance_failed",
        entityType: "case",
        entityId: opts.caseId,
        detail: { transitionKey, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  return { paymentId, status, advancedTo };
}

export function submitTrackingRequestToProvider(caseId: string): string {
  const runtime = loadRuntime(caseId);
  const result = trackingProvider().submit({
    caseId,
    code: runtime.code,
    contractType: runtime.contract?.contractType ?? null,
    parties: runtime.contract?.landlordName ?? runtime.contract?.sellerName ?? null,
  });
  return result.message;
}

export function markSignature(opts: {
  caseId: string;
  party: string;
  status: "signed" | "declined" | "pending";
  partyName?: string | null;
  note?: string | null;
  actor: ActorContext;
}): void {
  transaction(() => {
    Cases.upsertSignature({
      caseId: opts.caseId,
      party: opts.party,
      partyName: opts.partyName ?? null,
      status: opts.status,
      note: opts.note ?? null,
    });
    Cases.insertTimelineEvent({
      caseId: opts.caseId,
      kind: `signature.${opts.status}`,
      title: opts.status === "signed" ? "امضای طرف ثبت شد" : opts.status === "declined" ? "امتناع از امضا ثبت شد" : "وضعیت امضا بازنشانی شد",
      body: `طرف: ${opts.party}`,
      actorId: opts.actor.id ?? null,
      actorName: opts.actor.name ?? null,
      at: nowIso(),
    });
    Platform.writeAudit({
      actorType: opts.actor.type,
      actorId: opts.actor.id ?? null,
      actorName: opts.actor.name ?? null,
      action: `signature.${opts.status}`,
      entityType: "case",
      entityId: opts.caseId,
      detail: { party: opts.party },
    });
  });
}

export function reviewDocumentAction(opts: {
  documentId: string;
  status: "approved" | "rejected" | "incomplete";
  reviewNote?: string | null;
  actor: ActorContext;
}): { caseId: string } {
  const row = Cases.findDocumentById(opts.documentId);
  if (!row) throw new AppError("NOT_FOUND", "مدرک یافت نشد");
  transaction(() => {
    Cases.reviewDocument(row.id, opts.status, opts.reviewNote ?? null, opts.actor.id ?? "");
    Cases.insertTimelineEvent({
      caseId: row.case_id,
      kind: `documents.${opts.status}`,
      title: opts.status === "approved" ? "مدرک تأیید شد" : opts.status === "rejected" ? "مدرک رد شد" : "مدرک ناقص اعلام شد",
      body: `${row.title}${opts.reviewNote ? ` — ${opts.reviewNote}` : ""}`,
      actorId: opts.actor.id ?? null,
      actorName: opts.actor.name ?? null,
      at: nowIso(),
    });
    Platform.writeAudit({
      actorType: opts.actor.type,
      actorId: opts.actor.id ?? null,
      actorName: opts.actor.name ?? null,
      action: `document.${opts.status}`,
      entityType: "document",
      entityId: row.id,
      detail: { caseId: row.case_id, reviewNote: opts.reviewNote ?? null },
    });
  });
  return { caseId: row.case_id };
}

export function computeMatchesForCase(caseId: string): number {
  const requirement = Catalog.findRequirementByCase(caseId);
  if (!requirement) throw new AppError("NOT_FOUND", "نیازمندی این پرونده یافت نشد");
  const matches = Catalog.computeMatches(requirement);
  transaction(() => Catalog.replaceMatches(requirement.id, matches));
  return matches.length;
}

export function saveContractDetails(caseId: string, input: Record<string, unknown>, actor: ActorContext): void {
  const current = Cases.findContractByCase(caseId);
  if (!current) {
    Cases.upsertContract(caseId, {
      contract_type: (input.contractType as "rent" | "sale") ?? "rent",
      output_mode: (input.outputMode as "signature_only" | "signature_and_tracking") ?? "signature_only",
    });
  }
  // ورودی فرم با نام‌های دامنه (camelCase) می‌آید؛ به ستون‌های دیتابیس نگاشت می‌شود
  const patch = sanitizeContractPatch(input as Partial<ContractRuntime>);
  // کلیدهای از قبل snake_case را هم می‌پذیریم (تماس‌های درون‌سیستمی)
  for (const key of [
    "contract_type", "output_mode", "property_address", "city", "district", "area", "landlord_name", "tenant_name",
    "seller_name", "buyer_name", "deposit_amount", "rent_amount", "sale_price", "start_date", "end_date",
    "terms_note", "clause_version", "document_generated_at",
  ]) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  Cases.patchContract(caseId, patch);
  Platform.writeAudit({
    actorType: actor.type,
    actorId: actor.id ?? null,
    actorName: actor.name ?? null,
    action: "contract.details_saved",
    entityType: "case",
    entityId: caseId,
    detail: input,
  });
}

export function caseDetail(caseId: string) {
  const row = Cases.findCaseById(caseId);
  if (!row) throw new AppError("NOT_FOUND", "پرونده یافت نشد");
  const runtime = loadRuntime(caseId);
  const engine = buildEngine(loadDefinition(row.workflow_key, row.workflow_version));
  const definition = loadDefinition(row.workflow_key, row.workflow_version);
  return {
    row,
    runtime,
    definition,
    stateInfo: definition.states.find((s) => s.key === row.state) ?? null,
    transitions: Cases.listTransitions(caseId),
    timeline: Cases.listTimeline(caseId),
    tasks: Cases.listTasks({ caseId, status: ["open", "in_progress", "done"], limit: 50 }),
    documents: Cases.listDocuments(caseId),
    contract: Cases.findContractByCase(caseId),
    legalReviews: Cases.latestLegalReview(caseId) ? [Cases.latestLegalReview(caseId)!] : [],
    signatures: Cases.listSignatures(caseId),
    tracking: Cases.findTracking(caseId),
    payments: Finance.listPayments(caseId),
    invoices: Finance.listInvoices(caseId),
    listing: Catalog.findListingByCase(caseId),
    requirement: Catalog.findRequirementByCase(caseId),
    matches: Catalog.findRequirementByCase(caseId) ? Catalog.listMatches(Catalog.findRequirementByCase(caseId)!.id) : [],
    owner: row.owner_user_id ? People.findUserById(row.owner_user_id) : null,
    agent: row.agent_user_id ? People.findUserById(row.agent_user_id) : null,
    assignedStaff: row.assigned_staff_id ? People.findStaffById(row.assigned_staff_id) : null,
    availableTransitions: (actor: ActorContext) => engine.available(runtime, actor),
  };
}

export function queueStates(workflowKey: string): string[] {
  const definition = loadDefinition(workflowKey, 1);
  return definition.states.filter((s) => s.key.includes("queue") || s.node === "V3").map((s) => s.key);
}

export function operationalQueueStates(): string[] {
  return ["documents_pending_queue", "listing_review", "legal_review", "legal_result", "tracking_check", "tracking_request", "tracking_error", "payment_error", "signature_followup"];
}
