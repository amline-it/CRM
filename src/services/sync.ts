/**
 * سینک با سرور اصلی — کانال push (اینگست) و واکشی pull.
 * قرارداد API: docs/sync-api.md
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/errors";
import { hashPayload, newId } from "@/lib/ids";
import { jsonParse, nowIso, transaction } from "@/db/client";
import * as Cases from "@/db/repos/cases";
import * as Catalog from "@/db/repos/catalog";
import * as People from "@/db/repos/people";
import * as Platform from "@/db/repos/platform";
import * as Finance from "@/db/repos/finance";
import { loadDefinition } from "@/domain/workflows";
import { documentTitle } from "@/domain/service/case-service";

export type IngestEntity = "users" | "contracts" | "listings" | "requirements";

export type ItemAction = "created" | "updated" | "unchanged" | "rejected";

export interface ItemResult {
  externalId: string | null;
  action: ItemAction;
  reason?: string;
  id?: string;
}

export interface IngestResult {
  ok: boolean;
  status: number;
  entity: IngestEntity;
  summary: { received: number; created: number; updated: number; unchanged: number; rejected: number };
  items: ItemResult[];
  syncLogId: string | null;
  message?: string;
}

/* ── اعتبارسنجی درخواست ──────────────────────────────────────────── */

export interface IngestHeaders {
  apiKey?: string | null;
  signature?: string | null;
  idempotencyKey?: string | null;
  source?: string | null;
}

export function verifySignature(rawBody: string, signature: string | null | undefined, secret = process.env.SYNC_SECRET ?? ""): boolean {
  if (!secret) return false;
  const provided = (signature ?? "").trim();
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function checkIngestAuth(headers: IngestHeaders, rawBody: string): { ok: true } | { ok: false; status: number; message: string } {
  const expectedKey = process.env.SYNC_API_KEY ?? "";
  if (!expectedKey) return { ok: false, status: 503, message: "سینک روی این سرور پیکربندی نشده است (SYNC_API_KEY)" };
  if ((headers.apiKey ?? "") !== expectedKey) return { ok: false, status: 401, message: "کلید سینک نامعتبر است" };
  if (!verifySignature(rawBody, headers.signature)) return { ok: false, status: 401, message: "امضای بدنه نامعتبر است" };
  return { ok: true };
}

/* ── بدنه اینگست ─────────────────────────────────────────────────── */

export interface IngestBody {
  source?: string;
  items?: unknown[];
  [key: string]: unknown;
}

export function parseBody(rawBody: string): IngestBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new AppError("SYNC_INVALID", "بدنه درخواست JSON معتبر نیست");
  }
  if (Array.isArray(parsed)) return { items: parsed };
  if (parsed && typeof parsed === "object") return parsed as IngestBody;
  throw new AppError("SYNC_INVALID", "بدنه باید شیء یا آرایه باشد");
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/* ── اجرای اینگست ────────────────────────────────────────────────── */

export function ingest(entity: IngestEntity, body: IngestBody, headers: IngestHeaders): IngestResult {
  const source = asString(body.source) ?? asString(headers.source) ?? "main-server";
  const items = Array.isArray(body.items) ? body.items : [];
  const results: ItemResult[] = [];

  for (const raw of items) {
    if (!raw || typeof raw !== "object") {
      results.push({ externalId: null, action: "rejected", reason: "آیتم باید شیء باشد" });
      continue;
    }
    const item = raw as Record<string, unknown>;
    try {
      const result = handleItem(entity, item, source);
      results.push(result);
    } catch (err) {
      results.push({
        externalId: asString(item.externalId ?? item.id ?? item.external_id),
        action: "rejected",
        reason: err instanceof Error ? err.message : "خطای نامشخص",
      });
    }
  }

  const summary = {
    received: items.length,
    created: results.filter((r) => r.action === "created").length,
    updated: results.filter((r) => r.action === "updated").length,
    unchanged: results.filter((r) => r.action === "unchanged").length,
    rejected: results.filter((r) => r.action === "rejected").length,
  };

  // یک آیتم خراب کل باچ را رد نمی‌کند؛ همه در لاگ سینک ثبت می‌شوند
  const syncLogId = transaction(() => {
    const logId = Platform.insertSyncLog({
      direction: "in",
      channel: "push",
      entityType: entity,
      source,
      idempotencyKey: headers.idempotencyKey ?? null,
      itemCount: summary.received,
      created: summary.created,
      updated: summary.updated,
      unchanged: summary.unchanged,
      rejected: summary.rejected,
      status: summary.rejected === 0 ? "ok" : summary.created + summary.updated + summary.unchanged > 0 ? "partial" : "failed",
      detail: { results },
    });
    for (const result of results) {
      Platform.insertSyncItemResult({
        syncLogId: logId,
        entityType: entity.replace(/s$/, ""),
        externalId: result.externalId,
        action: result.action,
        reason: result.reason ?? null,
      });
    }
    return logId;
  });

  return { ok: summary.rejected < Math.max(1, summary.received), status: 200, entity, summary, items: results, syncLogId };
}

function handleItem(entity: IngestEntity, item: Record<string, unknown>, source: string): ItemResult {
  switch (entity) {
    case "users":
      return ingestUser(item, source);
    case "contracts":
      return ingestContract(item, source);
    case "listings":
      return ingestListing(item, source);
    case "requirements":
      return ingestRequirement(item, source);
    default:
      throw new AppError("SYNC_INVALID", `نوع موجودیت «${entity}» پشتیبانی نمی‌شود`);
  }
}

function ingestUser(item: Record<string, unknown>, source: string): ItemResult {
  const externalId = asString(item.externalId ?? item.id ?? item.external_id);
  if (!externalId) throw new AppError("SYNC_INVALID", "شناسه بیرونی کاربر (externalId) الزامی است");
  const fullName = asString(item.fullName ?? item.full_name ?? item.name);
  if (!fullName) throw new AppError("SYNC_INVALID", "نام کامل کاربر الزامی است");
  const payloadHash = asString(item.hash) ?? hashPayload(item);
  const result = People.upsertUser({
    externalId,
    source,
    fullName,
    nationalId: asString(item.nationalId ?? item.national_id),
    mobile: asString(item.mobile ?? item.phone),
    email: asString(item.email),
    userType: (asString(item.userType ?? item.user_type) === "agent" ? "agent" : "normal") as "normal" | "agent",
    agentLicenseNo: asString(item.agentLicenseNo ?? item.agent_license_no),
    city: asString(item.city),
    status: asString(item.status) ?? "active",
    payloadHash,
    raw: item,
    deleted: item.deleted === true,
  });
  return { externalId, action: result.action, id: result.id };
}

interface CaseSeed {
  serviceKey: string;
  workflowKey: string;
  title: string | null;
  externalId: string;
  source: string;
  ownerUserId: string | null;
  agentUserId: string | null;
  state?: string | null;
  deleted?: boolean;
}

function upsertSyncedCase(seed: CaseSeed): { caseId: string; action: ItemAction } {
  const existing = Cases.findCaseByExternal(seed.source, seed.externalId);
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (seed.title && seed.title !== existing.title) patch.title = seed.title;
    if (seed.ownerUserId && seed.ownerUserId !== existing.owner_user_id) patch.owner_user_id = seed.ownerUserId;
    if (seed.agentUserId && seed.agentUserId !== existing.agent_user_id) patch.agent_user_id = seed.agentUserId;
    if (seed.deleted) {
      patch.status = "closed";
      patch.outcome = existing.outcome ?? "deleted";
    } else if (seed.state && seed.state !== existing.state) {
      patch.state = seed.state;
    }
    const changed = Object.keys(patch).length > 0;
    if (changed) Cases.updateCase(existing.id, patch);
    return { caseId: existing.id, action: changed ? "updated" : "unchanged" };
  }
  const definition = loadDefinition(seed.workflowKey, 1);
  const state = seed.state && definition.states.some((s) => s.key === seed.state) ? seed.state : definition.initial;
  const caseId = Cases.createCase({
    code: null,
    externalId: seed.externalId,
    source: seed.source,
    title: seed.title,
    serviceKey: seed.serviceKey,
    workflowKey: seed.workflowKey,
    workflowVersion: definition.version,
    state,
    ownerUserId: seed.ownerUserId,
    agentUserId: seed.agentUserId,
  });
  Cases.insertTimelineEvent({
    caseId,
    kind: "sync.imported",
    title: "پرونده از سرور اصلی وارد شد",
    body: `شناسه بیرونی: ${seed.externalId}`,
    at: nowIso(),
    meta: { source: seed.source },
  });
  return { caseId, action: "created" };
}

function ingestContract(item: Record<string, unknown>, source: string): ItemResult {
  const externalId = asString(item.externalId ?? item.id ?? item.external_id);
  if (!externalId) throw new AppError("SYNC_INVALID", "شناسه بیرونی قرارداد (externalId) الزامی است");
  const contractType = asString(item.contractType ?? item.contract_type) === "sale" ? "sale" : "rent";
  const outputMode = asString(item.outputMode ?? item.output_mode) === "signature_and_tracking" ? "signature_and_tracking" : "signature_only";
  const ownerUserId = resolveUserRef(item, item.ownerExternalId ?? item.owner_user_external_id, source);
  const agentUserId = resolveUserRef(item, item.agentExternalId ?? item.agent_user_external_id, source);

  return transaction(() => {
    const { caseId, action } = upsertSyncedCase({
      serviceKey: "contract",
      workflowKey: "contract",
      externalId,
      source,
      title: asString(item.title) ?? "قرارداد (سینک‌شده)",
      ownerUserId,
      agentUserId,
      state: asString(item.state),
      deleted: item.deleted === true,
    });

    const existing = Cases.findContractByCase(caseId);
    const details: Record<string, unknown> = {
      contract_type: contractType,
      output_mode: outputMode,
      property_address: asString(item.propertyAddress ?? item.property_address ?? item.address),
      city: asString(item.city),
      district: asString(item.district),
      area: asNumber(item.area),
      landlord_name: asString(item.landlordName ?? item.landlord_name),
      tenant_name: asString(item.tenantName ?? item.tenant_name),
      seller_name: asString(item.sellerName ?? item.seller_name),
      buyer_name: asString(item.buyerName ?? item.buyer_name),
      deposit_amount: asNumber(item.depositAmount ?? item.deposit_amount ?? item.deposit),
      rent_amount: asNumber(item.rentAmount ?? item.rent_amount ?? item.rent),
      sale_price: asNumber(item.salePrice ?? item.sale_price ?? item.price),
      start_date: asString(item.startDate ?? item.start_date),
      end_date: asString(item.endDate ?? item.end_date),
      terms_note: asString(item.termsNote ?? item.terms_note),
    };
    if (!existing) {
      Cases.upsertContract(caseId, {
        contract_type: details.contract_type as "rent" | "sale",
        output_mode: details.output_mode as "signature_only" | "signature_and_tracking",
      });
      Cases.patchContract(caseId, details);
    } else {
      const changed = Object.entries(details).some(([key, value]) => value !== null && (existing as unknown as Record<string, unknown>)[key] !== value);
      if (changed) Cases.patchContract(caseId, details);
      return { externalId, action: action === "created" ? "created" : changed ? "updated" : action, id: caseId };
    }

    // اگر کد رهگیری در منبع هست، ثبت می‌شود
    const trackingCode = asString(item.trackingCode ?? item.tracking_code);
    if (trackingCode) {
      Cases.upsertTracking(caseId, { status: "received", code: trackingCode, attempts: 1 });
    }

    // مدارک معرفی‌شده در منبع
    const documents = Array.isArray(item.documents) ? item.documents : [];
    for (const doc of documents) {
      if (!doc || typeof doc !== "object") continue;
      const d = doc as Record<string, unknown>;
      const kind = asString(d.kind) ?? "document";
      Cases.upsertDocument({
        caseId,
        kind,
        title: asString(d.title) ?? documentTitle(kind),
        status: (asString(d.status) as "pending" | "submitted" | "incomplete" | "rejected" | "approved" | null) ?? "submitted",
        fileName: asString(d.fileName ?? d.file_name),
      });
    }
    return { externalId, action, id: caseId };
  });
}

function ingestListing(item: Record<string, unknown>, source: string): ItemResult {
  const externalId = asString(item.externalId ?? item.id ?? item.external_id);
  if (!externalId) throw new AppError("SYNC_INVALID", "شناسه بیرونی آگهی (externalId) الزامی است");
  const ownerUserId = resolveUserRef(item, item.ownerExternalId ?? item.owner_user_external_id, source);
  const agentUserId = resolveUserRef(item, item.agentExternalId ?? item.agent_user_external_id, source);

  return transaction(() => {
    const { caseId, action } = upsertSyncedCase({
      serviceKey: "listing",
      workflowKey: "listing",
      externalId,
      source,
      title: asString(item.title) ?? "آگهی (سینک‌شده)",
      ownerUserId,
      agentUserId,
      state: asString(item.state),
      deleted: item.deleted === true,
    });

    const patch: Record<string, unknown> = {
      deal_type: asString(item.dealType ?? item.deal_type) === "sale" ? "sale" : "rent",
      property_type: asString(item.propertyType ?? item.property_type),
      city: asString(item.city),
      district: asString(item.district),
      address: asString(item.address),
      area: asNumber(item.area),
      rooms: asNumber(item.rooms),
      year_built: asNumber(item.yearBuilt ?? item.year_built),
      price: asNumber(item.price),
      deposit: asNumber(item.deposit),
      rent: asNumber(item.rent),
      description: asString(item.description),
      amenities: Array.isArray(item.amenities) ? JSON.stringify(item.amenities) : undefined,
      images: Array.isArray(item.images) ? JSON.stringify(item.images) : undefined,
      status: (asString(item.status) ?? "draft") as string,
      external_id: externalId,
      source,
      owner_user_id: ownerUserId,
      agent_user_id: agentUserId,
      expires_at: asString(item.expiresAt ?? item.expires_at),
    };
    for (const key of Object.keys(patch)) if (patch[key] === undefined || patch[key] === null) delete patch[key];

    const existing = Catalog.findListingByExternal(source, externalId) ?? Catalog.findListingByCase(caseId);
    if (existing) {
      const changed = Object.entries(patch).some(([key, value]) => (existing as unknown as Record<string, unknown>)[key] !== value);
      if (changed) Catalog.updateListing(existing.id, patch);
      return { externalId, action: action === "created" ? "created" : changed ? "updated" : action, id: existing.id };
    }
    const listingId = Catalog.createListing({ ...patch, case_id: caseId, external_id: externalId, source });
    return { externalId, action, id: listingId };
  });
}

function ingestRequirement(item: Record<string, unknown>, source: string): ItemResult {
  const externalId = asString(item.externalId ?? item.id ?? item.external_id);
  if (!externalId) throw new AppError("SYNC_INVALID", "شناسه بیرونی نیازمندی (externalId) الزامی است");
  const requesterUserId = resolveUserRef(item, item.requesterExternalId ?? item.requester_user_external_id, source);

  return transaction(() => {
    const { caseId, action } = upsertSyncedCase({
      serviceKey: "requirements",
      workflowKey: "requirements",
      externalId,
      source,
      title: asString(item.title) ?? "نیازمندی (سینک‌شده)",
      ownerUserId: requesterUserId,
      agentUserId: null,
      state: asString(item.state),
      deleted: item.deleted === true,
    });

    const patch: Record<string, unknown> = {
      deal_type: asString(item.dealType ?? item.deal_type) === "sale" ? "sale" : "rent",
      property_type: asString(item.propertyType ?? item.property_type),
      city: asString(item.city),
      districts: Array.isArray(item.districts) ? JSON.stringify(item.districts) : asString(item.districts) ?? undefined,
      budget_min: asNumber(item.budgetMin ?? item.budget_min),
      budget_max: asNumber(item.budgetMax ?? item.budget_max),
      area_min: asNumber(item.areaMin ?? item.area_min),
      area_max: asNumber(item.areaMax ?? item.area_max),
      rooms: asNumber(item.rooms),
      description: asString(item.description),
      access_level: (asString(item.accessLevel ?? item.access_level) ?? "staff") as string,
      status: (asString(item.status) ?? "open") as string,
      expires_at: asString(item.expiresAt ?? item.expires_at),
      requester_user_id: requesterUserId,
      external_id: externalId,
      source,
    };
    for (const key of Object.keys(patch)) if (patch[key] === undefined || patch[key] === null) delete patch[key];

    const existing = Catalog.findRequirementByExternal(source, externalId) ?? Catalog.findRequirementByCase(caseId);
    if (existing) {
      const changed = Object.entries(patch).some(([key, value]) => (existing as unknown as Record<string, unknown>)[key] !== value);
      if (changed) Catalog.updateRequirement(existing.id, patch);
      return { externalId, action: action === "created" ? "created" : changed ? "updated" : action, id: existing.id };
    }
    const requirementId = Catalog.createRequirement({ ...patch, case_id: caseId, external_id: externalId, source });
    return { externalId, action, id: requirementId };
  });
}

function resolveUserRef(item: Record<string, unknown>, ref: unknown, source: string): string | null {
  const direct = asString(item.ownerUserId ?? item.requesterUserId ?? item.userId);
  if (direct) {
    const byId = People.findUserById(direct);
    if (byId) return byId.id;
  }
  const external = asString(ref);
  if (external) {
    const user = People.findUserByExternal(source, external);
    if (user) return user.id;
  }
  return null;
}

/* ── واکشی زمان‌بندی‌شده (pull) ───────────────────────────────────── */

export interface PullOutcome {
  entity: IngestEntity;
  ok: boolean;
  message: string;
  summary?: IngestResult["summary"];
}

/**
 * واکشی از سرور اصلی: برای هر موجودیت، از آخرین کرسور به بعد خوانده و همان اینگست اجرا می‌شود.
 * سرور شما باید endpoint هایی با پارامتر since برگرداند: GET {SYNC_PULL_URL}/{entity}?since=ISO
 */
export async function pullOnce(entity: IngestEntity): Promise<PullOutcome> {
  const baseUrl = process.env.SYNC_PULL_URL ?? "";
  const apiKey = process.env.SYNC_PULL_API_KEY ?? "";
  if (!baseUrl) return { entity, ok: false, message: "آدرس واکشی (SYNC_PULL_URL) تنظیم نشده است" };
  const cursor = Platform.getPullCursor(entity);
  const url = `${baseUrl.replace(/\/$/, "")}/${entity}?since=${encodeURIComponent(cursor.lastPulledAt ?? "")}`;
  try {
    const response = await fetch(url, {
      headers: {
        "X-Sync-Key": apiKey,
        Accept: "application/json",
      },
    });
    if (!response.ok) return { entity, ok: false, message: `پاسخ سرور اصلی: ${response.status}` };
    const payload = (await response.json()) as IngestBody;
    const result = ingest(entity, payload, { source: "pull", idempotencyKey: newId("pull") });
    Platform.setPullCursor(entity, nowIso(), null);
    return { entity, ok: true, message: `دریافت ${result.summary.received} آیتم`, summary: result.summary };
  } catch (err) {
    return { entity, ok: false, message: err instanceof Error ? err.message : "خطای واکشی" };
  }
}

/* ── وب‌هوک خروجی ────────────────────────────────────────────────── */

export function signOutboundPayload(payload: string, secret = process.env.WEBHOOK_SECRET || process.env.SYNC_SECRET || ""): string {
  return `sha256=${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
}

export interface WebhookDispatchResult {
  id: string;
  event: string;
  ok: boolean;
  attempts: number;
  error?: string;
}

/** ارسال وب‌هوک‌های سررسیده با backoff؛ حداکثر ۵ تلاش */
export async function dispatchDueWebhooks(limit = 20): Promise<WebhookDispatchResult[]> {
  const due = Platform.dueWebhooks(limit);
  const results: WebhookDispatchResult[] = [];
  for (const hook of due) {
    // اولویت: آدرس ثبت‌شده روی رکورد → تنظیمات پنل → متغیر محیطی
    const target =
      hook.target_url || Platform.getSetting<string>("sync.webhookUrl", process.env.WEBHOOK_TARGET_URL ?? "") || "";
    if (!target) {
      Platform.markWebhook(hook.id, { ok: false, error: "آدرس وب‌هوک تنظیم نشده است", attempts: hook.attempts + 1, backoffMinutes: 60 });
      results.push({ id: hook.id, event: hook.event, ok: false, attempts: hook.attempts + 1, error: "no-target" });
      continue;
    }
    const body = jsonParse<Record<string, unknown>>(hook.payload, {});
    const raw = JSON.stringify({ event: hook.event, data: body });
    try {
      const response = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Event": hook.event,
          "X-Webhook-Signature": signOutboundPayload(raw),
          "X-Webhook-Attempt": String(hook.attempts + 1),
        },
        body: raw,
      });
      if (response.ok) {
        Platform.markWebhook(hook.id, { ok: true, attempts: hook.attempts + 1 });
        results.push({ id: hook.id, event: hook.event, ok: true, attempts: hook.attempts + 1 });
      } else {
        const attempts = hook.attempts + 1;
        Platform.markWebhook(hook.id, { ok: false, error: `HTTP ${response.status}`, attempts, backoffMinutes: backoffMinutes(attempts) });
        results.push({ id: hook.id, event: hook.event, ok: false, attempts, error: `HTTP ${response.status}` });
      }
    } catch (err) {
      const attempts = hook.attempts + 1;
      Platform.markWebhook(hook.id, {
        ok: false,
        error: err instanceof Error ? err.message : "خطای شبکه",
        attempts,
        backoffMinutes: backoffMinutes(attempts),
      });
      results.push({ id: hook.id, event: hook.event, ok: false, attempts, error: "network" });
    }
  }
  return results;
}

function backoffMinutes(attempts: number): number {
  return Math.min(60 * 24, Math.round(2 ** attempts));
}

/* ── وضعیت سینک برای پنل مدیر ────────────────────────────────────── */

export function syncOverview() {
  return {
    logs: Platform.listSyncLog(30),
    webhooks: Platform.listWebhooks(30),
    cursors: {
      users: Platform.getPullCursor("users"),
      contracts: Platform.getPullCursor("contracts"),
      listings: Platform.getPullCursor("listings"),
      requirements: Platform.getPullCursor("requirements"),
    },
    pullEnabled: Platform.getSetting<boolean>("sync.pullEnabled", process.env.SYNC_PULL_ENABLED === "true"),
    pullUrl: Platform.getSetting<string>("sync.pullUrl", process.env.SYNC_PULL_URL ?? ""),
    webhookUrl: Platform.getSetting<string>("sync.webhookUrl", process.env.WEBHOOK_TARGET_URL ?? ""),
    lastSync: Platform.listSyncLog(1)[0] ?? null,
  };
}

export function recentPaymentsSummary() {
  return Finance.paymentStats();
}
