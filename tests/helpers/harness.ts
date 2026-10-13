/**
 * ابزار تست — ساخت وضعیت جهان و «اجرای» نقشه اثر (شبیه‌سازی لایه ذخیره‌سازی).
 */
import { Engine } from "@/domain/engine/engine";
import { createGuardRegistry } from "@/domain/guards";
import { createEffectRegistry } from "@/domain/effects";
import { loadDefinition } from "@/domain/workflows";
import type {
  ActorContext,
  ApplyInput,
  ApplyPlan,
  CaseRuntime,
  ContractRuntime,
  DocumentRuntime,
  SignatureRuntime,
  WorkflowDefinition,
} from "@/domain/engine/types";

export const staff: ActorContext = { type: "staff", id: "staff-1", name: "کارشناس آزمون" };
export const admin: ActorContext = { type: "admin", id: "admin-1", name: "مدیر آزمون" };

export const guards = createGuardRegistry();
export const effects = createEffectRegistry();

export function engine(workflowKey = "contract", version = 1): Engine {
  return new Engine(loadDefinition(workflowKey, version), { guards, effects });
}

export function definition(workflowKey = "contract", version = 1): WorkflowDefinition {
  return loadDefinition(workflowKey, version);
}

const FIXED_NOW = new Date("2026-10-13T08:30:00.000Z");

export function makeRuntime(overrides: Partial<CaseRuntime> = {}): CaseRuntime {
  const base: CaseRuntime = {
    caseId: "case-1",
    code: null,
    serviceKey: "contract",
    workflowKey: "contract",
    workflowVersion: 1,
    state: "contract_start",
    status: "open",
    outcome: null,
    priority: "normal",
    dueAt: null,
    requiresTracking: false,
    attempts: { payment: 0, tracking: 0 },
    accessLevel: null,
    assignedStaffId: null,
    ownerUserId: "user-1",
    agentUserId: null,
    contract: null,
    documents: [],
    requiredDocuments: ["ownership", "national_id"],
    legalReview: null,
    signatures: [],
    requiredSignatures: ["landlord", "tenant"],
    tracking: null,
    payments: [],
    invoices: [],
    subscription: null,
    referral: null,
    listing: null,
    requirement: null,
    matches: [],
    openTaskId: null,
    now: FIXED_NOW.toISOString(),
    settings: {
      serviceName: "قرارداد",
      servicePrice: 500_000,
      serviceRequiresPayment: true,
      nextCaseCode: "CRM-1405-000001",
      listingDurationDays: 30,
    },
  };
  return { ...base, ...overrides, settings: { ...base.settings, ...(overrides.settings ?? {}) } };
}

export function rentContract(overrides: Partial<ContractRuntime> = {}): ContractRuntime {
  return {
    contractType: "rent",
    outputMode: "signature_only",
    propertyAddress: "تهران، سعادت‌آباد، پلاک ۱۲",
    city: "تهران",
    district: "سعادت‌آباد",
    area: 95,
    landlordName: "آقای مالکی",
    tenantName: "خانم مستأجر",
    sellerName: null,
    buyerName: null,
    depositAmount: 500_000_000,
    rentAmount: 30_000_000,
    salePrice: null,
    startDate: "2026-11-01T00:00:00.000Z",
    endDate: "2027-11-01T00:00:00.000Z",
    termsNote: "بند ۱ ...",
    clauseVersion: 1,
    documentGeneratedAt: null,
    ...overrides,
  };
}

export function saleContract(overrides: Partial<ContractRuntime> = {}): ContractRuntime {
  return rentContract({
    contractType: "sale",
    landlordName: null,
    tenantName: null,
    sellerName: "آقای فروشنده",
    buyerName: "آقای خریدار",
    salePrice: 9_500_000_000,
    depositAmount: null,
    rentAmount: null,
    ...overrides,
  } as Partial<ContractRuntime>);
}

export function documents(statuses: Array<DocumentRuntime["status"]>): DocumentRuntime[] {
  return statuses.map((status, i) => ({ id: `doc-${i + 1}`, kind: i === 0 ? "ownership" : "national_id", title: i === 0 ? "سند مالکیت" : "کارت ملی", status }));
}

export function signatures(all: SignatureRuntime["status"][], parties = ["landlord", "tenant"]): SignatureRuntime[] {
  return parties.map((party, i) => ({ id: `sig-${i + 1}`, party, partyName: party, status: all[i] ?? "pending", method: "in_person" }));
}

/** اجرای گذار با موتور و «ذخیره» نقشه روی وضعیت جهان (شبیه لایه اپلیکیشن) */
export function apply(
  eng: Engine,
  runtime: CaseRuntime,
  input: Omit<ApplyInput, "runtime"> & { now?: Date },
): { runtime: CaseRuntime; plan: ApplyPlan } {
  const plan = eng.plan({ ...input, runtime, now: input.now ?? new Date(runtime.now) });
  return { runtime: commitPlan(runtime, plan), plan };
}

export function commitPlan(runtime: CaseRuntime, plan: ApplyPlan): CaseRuntime {
  const next: CaseRuntime = { ...runtime, state: plan.to, now: plan.at };
  const p = plan.casePatch;
  if (p.code !== undefined) next.code = p.code;
  if (p.status !== undefined) next.status = p.status;
  if (p.outcome !== undefined) next.outcome = p.outcome;
  if (p.priority !== undefined) next.priority = p.priority;
  if (p.dueAt !== undefined) next.dueAt = p.dueAt;
  if (p.requiresTracking !== undefined) next.requiresTracking = p.requiresTracking;
  if (p.accessLevel !== undefined) next.accessLevel = p.accessLevel;
  if (p.assignedStaffId !== undefined) next.assignedStaffId = p.assignedStaffId;
  if (p.attempts) next.attempts = { ...next.attempts, ...p.attempts };
  if (p.contractPatch && next.contract) next.contract = { ...next.contract, ...p.contractPatch };
  if (p.legalReview !== undefined) next.legalReview = p.legalReview;
  if (p.listingPatch && next.listing) next.listing = { ...next.listing, ...p.listingPatch };
  if (p.requirementPatch && next.requirement) next.requirement = { ...next.requirement, ...p.requirementPatch };
  if (plan.signatures.length) {
    const map = new Map(next.signatures.map((s) => [s.party, s]));
    for (const sig of plan.signatures) {
      const existing = map.get(sig.party);
      map.set(sig.party, existing ? { ...existing, ...sig } : { id: `sig-${map.size + 1}`, ...sig });
    }
    next.signatures = [...map.values()];
  }
  if (plan.trackingRequest) {
    next.tracking = {
      status: plan.trackingRequest.status,
      code: plan.trackingRequest.code ?? null,
      error: plan.trackingRequest.error ?? null,
      attempts: (next.attempts.tracking ?? 0) + (plan.transitionKey.includes("retry") ? 1 : 0),
    };
  }
  if (plan.invoice) {
    next.invoices = [...next.invoices, { id: `inv-${next.invoices.length + 1}`, status: plan.invoice.status, amount: plan.invoice.amount }];
  }
  return next;
}
