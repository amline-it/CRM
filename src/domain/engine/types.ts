/**
 * نوع‌های موتور گردش‌کار — تعریف داده‌محور، اجرای خالص (pure).
 *
 * اصل طراحی: موتور هیچ I/O ندارد. لایه اپلیکیشن «وضعیت جهان» (CaseRuntime) را
 * بارگذاری می‌کند، موتور برای گذار «نقشه اثر» (ApplyPlan) می‌سازد و لایه اپلیکیشن
 * آن را در یک تراکنش ذخیره می‌کند. نتیجه: تست‌پذیری کامل و بازتولیدپذیری.
 */

export type StateType = "start" | "process" | "decision" | "error" | "terminal";
export type ActorRole = "staff" | "admin" | "system" | "api";
export type Origin = "crm" | "partner" | "system" | "either";
export type TransitionKind = "choice" | "action" | "auto";
export type Priority = "low" | "normal" | "high" | "urgent";

export interface WorkflowState {
  key: string;
  name: string;
  type: StateType;
  /** شناسه گره در فلوچارت منبع (برای ردیابی کارفرما) */
  node?: string;
  /** حالتی که در حلقه خطا به آن برمی‌گردیم */
  loop?: string;
  terminal?: boolean;
  outcome?: string;
}

export interface GuardSpec {
  key: string;
  params?: Record<string, unknown>;
  /** شرط برعکس (مثل «اشتراک معتبر نیست») */
  negate?: boolean;
  /** نیازمند دلیل متنی از کاربر */
  withReason?: boolean;
}

export interface EffectSpec {
  key: string;
  params?: Record<string, unknown>;
}

export interface TransitionOption {
  value: string;
  label: string;
  to: string;
  guards?: GuardSpec[];
  effects?: EffectSpec[];
}

export interface WorkflowTransition {
  key: string;
  name: string;
  from: string[];
  /** برای گذارهای choice خالی است و هر گزینه مقصد خودش را دارد */
  to?: string;
  kind: TransitionKind;
  origin: Origin;
  actors: ActorRole[];
  guards?: GuardSpec[];
  effects?: EffectSpec[];
  options?: TransitionOption[];
  /** رویداد بیرونی که این گذار را فعال می‌کند (سینک/شریک) */
  triggerEvent?: string;
  description?: string;
}

export interface WorkflowDefinition {
  key: string;
  version: number;
  name: string;
  description?: string;
  context: string;
  initial: string;
  roles?: Record<string, string>;
  accessLevels?: Record<string, string>;
  parameters?: Record<string, string>;
  examples?: Array<{ key: string; name: string; parameters: Record<string, unknown> }>;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
  crm?: { onTerminal?: EffectSpec[] };
}

/* ── وضعیت جهان (ورودی گاردها) ────────────────────────────────────── */

export interface ActorContext {
  type: ActorRole;
  id?: string;
  name?: string;
}

export interface ContractRuntime {
  contractType: "rent" | "sale";
  outputMode: "signature_only" | "signature_and_tracking";
  propertyAddress?: string | null;
  city?: string | null;
  district?: string | null;
  area?: number | null;
  landlordName?: string | null;
  tenantName?: string | null;
  sellerName?: string | null;
  buyerName?: string | null;
  depositAmount?: number | null;
  rentAmount?: number | null;
  salePrice?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  termsNote?: string | null;
  clauseVersion: number;
  documentGeneratedAt?: string | null;
}

export interface DocumentRuntime {
  id: string;
  kind: string;
  title: string;
  status: "pending" | "submitted" | "incomplete" | "rejected" | "approved";
}

export interface LegalReviewRuntime {
  result: "approved" | "needs_edit" | "rejected";
  note?: string | null;
  clauseVersionAtReview?: number | null;
}

export interface SignatureRuntime {
  id: string;
  party: string;
  partyName?: string | null;
  status: "pending" | "signed" | "declined";
  method?: string | null;
}

export interface TrackingRuntime {
  status: "requested" | "in_progress" | "error" | "received";
  code?: string | null;
  error?: string | null;
  attempts: number;
}

export interface PaymentRuntime {
  id: string;
  method: "direct" | "subscription" | "referral" | "free";
  status: "pending" | "succeeded" | "failed";
  amount?: number | null;
}

export interface InvoiceRuntime {
  id: string;
  status: "unpaid" | "paid" | "void";
  amount: number;
}

export interface SubscriptionRuntime {
  id: string;
  status: "active" | "expired";
  scope: string[];
  endsAt?: string | null;
}

export interface ReferralRuntime {
  id: string;
  code: string;
  kind: "referral" | "waiver";
  status: "pending" | "approved" | "rejected";
  scope?: string[] | null;
}

export interface ListingRuntime {
  id: string;
  dealType: "rent" | "sale";
  propertyType: string;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  area?: number | null;
  rooms?: number | null;
  price?: number | null;
  deposit?: number | null;
  rent?: number | null;
  description?: string | null;
  images: string[];
  status: "draft" | "pending_review" | "published" | "paused" | "expired" | "closed";
  expiresAt?: string | null;
}

export interface RequirementRuntime {
  id: string;
  dealType: "rent" | "sale";
  propertyType?: string | null;
  city?: string | null;
  districts: string[];
  budgetMin?: number | null;
  budgetMax?: number | null;
  areaMin?: number | null;
  areaMax?: number | null;
  rooms?: number | null;
  accessLevel: "public" | "agents" | "staff";
  status: "open" | "matched" | "fulfilled" | "expired" | "cancelled";
  expiresAt?: string | null;
}

export interface MatchRuntime {
  id: string;
  listingId: string;
  score: number;
}

export interface CaseRuntime {
  caseId: string;
  code?: string | null;
  serviceKey: string;
  workflowKey: string;
  workflowVersion: number;
  state: string;
  status: "open" | "closed";
  outcome?: string | null;
  priority: Priority;
  dueAt?: string | null;
  requiresTracking: boolean;
  attempts: { payment: number; tracking: number; listing?: number };
  accessLevel?: string | null;
  assignedStaffId?: string | null;
  ownerUserId?: string | null;
  agentUserId?: string | null;
  contract?: ContractRuntime | null;
  documents: DocumentRuntime[];
  requiredDocuments: string[];
  legalReview?: LegalReviewRuntime | null;
  signatures: SignatureRuntime[];
  requiredSignatures: string[];
  tracking?: TrackingRuntime | null;
  payments: PaymentRuntime[];
  invoices: InvoiceRuntime[];
  subscription?: SubscriptionRuntime | null;
  referral?: ReferralRuntime | null;
  listing?: ListingRuntime | null;
  requirement?: RequirementRuntime | null;
  matches: MatchRuntime[];
  openTaskId?: string | null;
  now: string;
  settings: Record<string, unknown>;
}

/* ── خروجی موتور: نقشه اثر ───────────────────────────────────────── */

export interface TimelineEventSpec {
  kind: string;
  title: string;
  body?: string | null;
  visibility?: "internal" | "external";
  actorId?: string | null;
  actorName?: string | null;
  at: string;
  meta?: Record<string, unknown>;
}

export interface TaskSpec {
  title: string;
  description?: string | null;
  priority: Priority;
  dueAt: string;
  assigneeId?: string | null;
  dedupeKey?: string | null;
}

export interface TaskUpdateSpec {
  taskId?: string | null;
  markDone?: boolean;
  resultNote?: string | null;
  rescheduleHours?: number | null;
}

export interface NotificationSpec {
  channel: "sms" | "email" | "inapp";
  template: string;
  toUserId?: string | null;
  toAddress?: string | null;
  body: string;
}

export interface DocumentSpec {
  kind: string;
  title: string;
  status: "pending" | "incomplete" | "rejected" | "approved";
  note?: string | null;
}

export interface SignatureSpec {
  party: string;
  partyName?: string | null;
  status: "pending" | "signed" | "declined";
  method?: string | null;
}

export interface TrackingRequestSpec {
  status: TrackingRuntime["status"];
  code?: string | null;
  error?: string | null;
}

export interface InvoiceSpec {
  title: string;
  amount: number;
  status: "unpaid" | "paid" | "void";
  method: PaymentRuntime["method"];
}

export interface PaymentSpec {
  method: PaymentRuntime["method"];
  amount: number;
  status: "pending" | "succeeded" | "failed";
  provider?: string | null;
  providerRef?: string | null;
  error?: string | null;
}

export interface ListingPatch {
  status?: ListingRuntime["status"];
  expiresAt?: string | null;
  publishedAt?: string | null;
}

export interface RequirementPatch {
  status?: RequirementRuntime["status"];
  accessLevel?: RequirementRuntime["accessLevel"];
}

export interface OutboundEventSpec {
  event: string;
  payload: Record<string, unknown>;
}

export interface CasePatch {
  code?: string | null;
  outcome?: string | null;
  status?: "open" | "closed";
  priority?: Priority;
  dueAt?: string | null;
  requiresTracking?: boolean;
  accessLevel?: string | null;
  assignedStaffId?: string | null;
  attempts?: { payment?: number; tracking?: number; listing?: number };
  contractPatch?: Partial<ContractRuntime>;
  legalReview?: LegalReviewRuntime | null;
  subscriptions?: { consume?: boolean };
  referralUse?: { consume: boolean; code?: string };
  listingPatch?: ListingPatch | null;
  requirementPatch?: RequirementPatch | null;
  serviceData?: Record<string, unknown>;
}

export interface EffectTrace {
  key: string;
  params?: Record<string, unknown>;
  summary: string;
}

export interface ApplyPlan {
  caseId: string;
  workflowKey: string;
  workflowVersion: number;
  from: string;
  to: string;
  transitionKey: string;
  transitionName: string;
  option?: string | null;
  actor: ActorContext;
  reason?: string | null;
  at: string;
  casePatch: CasePatch;
  events: TimelineEventSpec[];
  tasks: TaskSpec[];
  taskUpdates: TaskUpdateSpec[];
  notifications: NotificationSpec[];
  documents: DocumentSpec[];
  signatures: SignatureSpec[];
  trackingRequest?: TrackingRequestSpec | null;
  invoice?: InvoiceSpec | null;
  payment?: PaymentSpec | null;
  outbound: OutboundEventSpec[];
  traces: EffectTrace[];
  warnings: string[];
}

/* ── گاردها و افکت‌ها ─────────────────────────────────────────────── */

export interface GuardContext {
  runtime: CaseRuntime;
  actor: ActorContext;
  reason?: string | null;
  payload: Record<string, unknown>;
  now: Date;
  transition: WorkflowTransition;
  option?: TransitionOption | null;
  params: Record<string, unknown>;
  negation: boolean;
}

export type GuardResult = boolean | { ok: boolean; code?: string; message?: string };
export type GuardFn = (ctx: GuardContext) => GuardResult;

export interface GuardRegistry {
  has(key: string): boolean;
  get(key: string): GuardFn | undefined;
  keys(): string[];
}

export interface EffectContext {
  runtime: CaseRuntime;
  plan: ApplyPlan;
  actor: ActorContext;
  reason?: string | null;
  payload: Record<string, unknown>;
  now: Date;
  transition: WorkflowTransition;
  option?: TransitionOption | null;
  params: Record<string, unknown>;
  /** تنظیمات نصب (مثل جریمه/مهلت‌ها) */
  settings: Record<string, unknown>;
}

export type EffectFn = (ctx: EffectContext) => void;

export interface EffectRegistry {
  has(key: string): boolean;
  get(key: string): EffectFn | undefined;
  keys(): string[];
}

export interface EngineDeps {
  guards: GuardRegistry;
  effects: EffectRegistry;
}

/* ── ورودی/خروجی اجرا ─────────────────────────────────────────────── */

export interface ApplyInput {
  runtime: CaseRuntime;
  transitionKey: string;
  option?: string | null;
  actor: ActorContext;
  reason?: string | null;
  payload?: Record<string, unknown>;
  triggerEvent?: string | null;
  now?: Date;
}

export interface AvailableOption {
  value: string;
  label: string;
  to: string;
  allowed: boolean;
  reason?: string | null;
}

export interface AvailableTransition {
  key: string;
  name: string;
  kind: TransitionKind;
  to?: string;
  requiresReason: boolean;
  allowed: boolean;
  reason?: string | null;
  /** برای گذارهای choice: گزینه‌ها با وضعیت دسترسی */
  options?: AvailableOption[];
  description?: string;
}
