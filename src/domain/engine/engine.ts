/**
 * موتور گردش‌کار — خالص، بدون I/O.
 *
 * planTransition: گذار انتخابی را اعتبارسنجی می‌کند، گاردها را می‌سنجد، افکت‌ها را
 * به «نقشه اثر» تبدیل می‌کند و سپس گذارهای خودکار (auto) را تا جایی که شرط‌ها
 * برقرارند زنجیره می‌کند — با محافظ حلقه و سقف گام.
 */
import { GuardFailedError, AppError } from "@/lib/errors";
import type {
  ActorContext,
  ActorRole,
  ApplyInput,
  ApplyPlan,
  AvailableOption,
  AvailableTransition,
  CaseRuntime,
  EffectContext,
  EngineDeps,
  GuardContext,
  GuardSpec,
  TransitionOption,
  WorkflowDefinition,
  WorkflowTransition,
} from "./types";

const MAX_AUTO_STEPS = 25;

export class Engine {
  constructor(
    readonly definition: WorkflowDefinition,
    private readonly deps: EngineDeps,
  ) {}

  private stateMap(): Map<string, WorkflowDefinition["states"][number]> {
    return new Map(this.definition.states.map((s) => [s.key, s]));
  }

  transition(key: string): WorkflowTransition | undefined {
    return this.definition.transitions.find((t) => t.key === key);
  }

  state(key: string) {
    return this.definition.states.find((s) => s.key === key);
  }

  /** گذارهای قابل نمایش/اجرا برای این پرونده و این نقش */
  available(runtime: CaseRuntime, actor: ActorContext): AvailableTransition[] {
    const result: AvailableTransition[] = [];
    for (const tr of this.definition.transitions) {
      if (!tr.from.includes(runtime.state)) continue;
      if (tr.kind === "auto") continue; // خودکار اجرا می‌شوند، در UI نمایش داده نمی‌شوند
      if (!this.canActor(tr, actor.type)) {
        result.push({
          key: tr.key,
          name: tr.name,
          kind: tr.kind,
          to: tr.to,
          requiresReason: this.requiresReason(tr),
          allowed: false,
          reason: this.actorDeniedMessage(tr),
          description: tr.description,
        });
        continue;
      }
      const guardFailure = this.firstGuardFailure(tr.guards, tr, actor, runtime, null, undefined);
      if (guardFailure) {
        result.push({
          key: tr.key,
          name: tr.name,
          kind: tr.kind,
          to: tr.to,
          requiresReason: this.requiresReason(tr),
          allowed: false,
          reason: guardFailure.message,
          description: tr.description,
        });
        continue;
      }
      if (tr.kind === "choice") {
        const options: AvailableOption[] = (tr.options ?? []).map((option) => {
          const failure = this.firstGuardFailure(option.guards, tr, actor, runtime, option, undefined);
          return {
            value: option.value,
            label: option.label,
            to: option.to,
            allowed: !failure,
            reason: failure?.message ?? null,
          };
        });
        const anyAllowed = options.some((o) => o.allowed);
        result.push({
          key: tr.key,
          name: tr.name,
          kind: tr.kind,
          requiresReason: this.requiresReason(tr, tr.options),
          allowed: anyAllowed,
          reason: anyAllowed ? null : "هیچ‌کدام از گزینه‌ها در وضعیت فعلی مجاز نیست",
          options,
          description: tr.description,
        });
        continue;
      }
      result.push({
        key: tr.key,
        name: tr.name,
        kind: tr.kind,
        to: tr.to,
        requiresReason: this.requiresReason(tr),
        allowed: true,
        description: tr.description,
      });
    }
    return result;
  }

  private canActor(tr: WorkflowTransition, actor: ActorRole): boolean {
    if (actor === "api") return tr.origin === "partner" || tr.origin === "either";
    return tr.actors.includes(actor);
  }

  private actorDeniedMessage(tr: WorkflowTransition): string {
    const labels = tr.actors
      .filter((a) => a !== "system" && a !== "api")
      .map((a) => this.definition.roles?.[a] ?? a)
      .join(" یا ");
    return labels ? `این گذار فقط برای «${labels}» مجاز است` : "این گذار برای نقش شما مجاز نیست";
  }

  private requiresReason(tr: WorkflowTransition, extra: TransitionOption[] | undefined = undefined): boolean {
    const lists: GuardSpec[][] = [tr.guards ?? [], ...(extra ?? []).map((o) => o.guards ?? [])];
    return lists.some((list) => list.some((g) => g.withReason));
  }

  private firstGuardFailure(
    specs: GuardSpec[] | undefined,
    tr: WorkflowTransition,
    actor: ActorContext,
    runtime: CaseRuntime,
    option: TransitionOption | null,
    reason: string | null | undefined,
  ): { guard: string; message: string } | null {
    for (const spec of specs ?? []) {
      const fn = this.deps.guards.get(spec.key);
      if (!fn) throw new AppError("INTERNAL", `گارد «${spec.key}» پیاده‌سازی نشده است`, { details: { guard: spec.key } });
      const ctx: GuardContext = {
        runtime,
        actor,
        reason,
        payload: runtime.settings.__payload && typeof runtime.settings.__payload === "object"
          ? (runtime.settings.__payload as Record<string, unknown>)
          : {},
        now: new Date(runtime.now),
        transition: tr,
        option,
        params: (spec.params ?? {}) as Record<string, unknown>,
        negation: spec.negate === true || spec.params?.negate === true,
      };
      const outcome = fn(ctx);
      const guardOk = typeof outcome === "boolean" ? outcome : outcome.ok;
      const negate = spec.negate === true || spec.params?.negate === true;
      const effective = negate ? !guardOk : guardOk;
      if (!effective) {
        const message =
          typeof outcome === "object" && outcome.message
            ? outcome.message
            : `شرط «${spec.key}» برای این گذار برقرار نیست`;
        return { guard: spec.key, message };
      }
    }
    return null;
  }

  /** ساخت نقشه اثر برای یک گذار (بدون زنجیره خودکار) */
  private planSingle(
    input: ApplyInput,
    tr: WorkflowTransition,
    option: TransitionOption | null,
    targetState: string,
    actor: ActorContext,
  ): ApplyPlan {
    const { runtime, payload = {}, reason = null } = input;
    const now = input.now ?? new Date();
    const plan: ApplyPlan = {
      caseId: runtime.caseId,
      workflowKey: this.definition.key,
      workflowVersion: this.definition.version,
      from: runtime.state,
      to: targetState,
      transitionKey: tr.key,
      transitionName: tr.name,
      option: option?.value ?? null,
      actor,
      reason,
      at: now.toISOString(),
      casePatch: {},
      events: [],
      tasks: [],
      taskUpdates: [],
      notifications: [],
      documents: [],
      signatures: [],
      trackingRequest: null,
      invoice: null,
      payment: null,
      outbound: [],
      traces: [],
      warnings: [],
    };

    const applyEffects = (effects: Array<{ key: string; params?: Record<string, unknown> }> | undefined, phase: string) => {
      for (const effect of effects ?? []) {
        const fn = this.deps.effects.get(effect.key);
        if (!fn) throw new AppError("INTERNAL", `افکت «${effect.key}» پیاده‌سازی نشده است`, { details: { effect: effect.key } });
        const ctx: EffectContext = {
          runtime,
          plan,
          actor,
          reason,
          payload,
          now,
          transition: tr,
          option,
          params: (effect.params ?? {}) as Record<string, unknown>,
          settings: runtime.settings,
        };
        fn(ctx);
        plan.traces.push({ key: effect.key, params: effect.params, summary: `${phase}: ${effect.key}` });
      }
    };

    applyEffects(tr.effects, "transition");
    applyEffects(option?.effects, "option");
    return plan;
  }

  /** اعمال پچ نقشه روی وضعیت جهان — برای ارزیابی درست گاردها در گام‌های زنجیره خودکار */
  private applyPatchToRuntime(runtime: CaseRuntime, patch: ApplyPlan["casePatch"]): CaseRuntime {
    const next: CaseRuntime = { ...runtime };
    if (patch.code !== undefined) next.code = patch.code;
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.outcome !== undefined) next.outcome = patch.outcome;
    if (patch.priority !== undefined) next.priority = patch.priority;
    if (patch.dueAt !== undefined) next.dueAt = patch.dueAt;
    if (patch.requiresTracking !== undefined) next.requiresTracking = patch.requiresTracking;
    if (patch.accessLevel !== undefined) next.accessLevel = patch.accessLevel;
    if (patch.assignedStaffId !== undefined) next.assignedStaffId = patch.assignedStaffId;
    if (patch.attempts) next.attempts = { ...next.attempts, ...patch.attempts };
    if (patch.contractPatch && next.contract) next.contract = { ...next.contract, ...patch.contractPatch };
    if (patch.legalReview !== undefined) next.legalReview = patch.legalReview;
    if (patch.listingPatch && next.listing) next.listing = { ...next.listing, ...patch.listingPatch };
    if (patch.requirementPatch && next.requirement) next.requirement = { ...next.requirement, ...patch.requirementPatch };
    return next;
  }

  /**
   * اعتبارسنجی + ساخت نقشه + زنجیره گذارهای خودکار.
   * خطاها: INVALID_TRANSITION / FORBIDDEN / GUARD_FAILED — همه با پیام فارسی.
   */
  plan(input: ApplyInput): ApplyPlan {
    const { runtime, actor, reason = null, payload = {} } = input;
    const tr = this.transition(input.transitionKey);
    if (!tr) {
      throw new AppError("INVALID_TRANSITION", `گذار «${input.transitionKey}» در این گردش‌کار وجود ندارد`, {
        details: { transition: input.transitionKey, workflow: this.definition.key },
      });
    }
    if (!tr.from.includes(runtime.state)) {
      const stateName = this.state(runtime.state)?.name ?? runtime.state;
      throw new AppError("INVALID_TRANSITION", `این گذار از وضعیت «${stateName}» امکان‌پذیر نیست`, {
        details: { current: runtime.state, allowedFrom: tr.from },
      });
    }
    if (!this.canActor(tr, actor.type)) {
      throw new AppError("FORBIDDEN", this.actorDeniedMessage(tr), {
        details: { transition: tr.key, actors: tr.actors, actor: actor.type },
      });
    }

    // گاردهای سطح گذار
    const runtimeWithPayload: CaseRuntime = { ...runtime, settings: { ...runtime.settings, __payload: payload } };
    const failure = this.firstGuardFailure(tr.guards, tr, actor, runtimeWithPayload, null, reason);
    if (failure) throw new GuardFailedError(failure.guard, failure.message, { transition: tr.key });

    let option: TransitionOption | null = null;
    let targetState: string;
    if (tr.kind === "choice") {
      if (!input.option) {
        throw new AppError("VALIDATION", "برای این گذار باید یکی از گزینه‌ها انتخاب شود", {
          details: { transition: tr.key, options: (tr.options ?? []).map((o) => o.value) },
        });
      }
      const found = (tr.options ?? []).find((o) => o.value === input.option);
      if (!found) {
        throw new AppError("VALIDATION", `گزینه «${input.option}» برای این گذار تعریف نشده است`, {
          details: { transition: tr.key, options: (tr.options ?? []).map((o) => o.value) },
        });
      }
      option = found;
      const optionFailure = this.firstGuardFailure(option.guards, tr, actor, runtimeWithPayload, option, reason);
      if (optionFailure) throw new GuardFailedError(optionFailure.guard, optionFailure.message, { transition: tr.key, option: option.value });
      targetState = option.to;
    } else {
      targetState = tr.to as string;
    }

    const plan = this.planSingle(input, tr, option, targetState, actor);

    // زنجیره گذارهای خودکار — با وضعیت به‌روزشده در هر گام
    let current = targetState;
    let chainRuntime = this.applyPatchToRuntime(runtimeWithPayload, plan.casePatch);
    const visited = new Set<string>([`${runtime.state}:${tr.key}`]);
    const chainActor: ActorContext = { type: "system", name: "موتور گردش‌کار" };
    for (let step = 0; step < MAX_AUTO_STEPS; step += 1) {
      const candidates = this.definition.transitions.filter(
        (t) => t.kind === "auto" && t.from.includes(current) && t.actors.includes("system"),
      );
      if (!candidates.length) break;
      let picked: { tr: WorkflowTransition; to: string } | null = null;
      const failures: string[] = [];
      for (const candidate of candidates) {
        const passes = this.firstGuardFailure(candidate.guards, candidate, chainActor, chainRuntime, null, null);
        if (!passes) {
          const to = candidate.to as string;
          picked = { tr: candidate, to };
          break;
        }
        failures.push(`${candidate.key}: ${passes.message}`);
      }
      if (!picked) {
        if (failures.length) plan.warnings.push(`گذار خودکار از «${current}» عبور نکرد (${failures.join(" ، ")})`);
        break;
      }
      const signature = `${current}:${picked.tr.key}`;
      if (visited.has(signature)) {
        plan.warnings.push(`حلقه خودکار شناسایی شد روی «${picked.tr.key}» — زنجیره متوقف شد`);
        break;
      }
      visited.add(signature);
      const single = this.planSingle({ ...input, runtime: chainRuntime, now: input.now }, picked.tr, null, picked.to, chainActor);
      current = picked.to;
      chainRuntime = this.applyPatchToRuntime(chainRuntime, single.casePatch);
      // ادغام نقشه خودکار در نقشه اصلی
      plan.to = current;
      plan.events.push(...single.events);
      plan.tasks.push(...single.tasks);
      plan.taskUpdates.push(...single.taskUpdates);
      plan.notifications.push(...single.notifications);
      plan.documents.push(...single.documents);
      plan.signatures.push(...single.signatures);
      plan.outbound.push(...single.outbound);
      plan.traces.push(...single.traces);
      plan.warnings.push(...single.warnings);
      plan.casePatch = mergeCasePatch(plan.casePatch, single.casePatch);
      if (single.trackingRequest) plan.trackingRequest = single.trackingRequest;
      if (single.invoice) plan.invoice = single.invoice;
      if (single.payment) plan.payment = single.payment;
      if (single.from !== plan.from) {
        // از زنجیره خودکار عبور کرده‌ایم؛ وضعیت میانی ثبت نمی‌شود، فقط گذار اصلي نماینده است
      }
    }

    // حالت پایانی: افکت‌های CRM (رویداد + وظیفه پیگیری)
    const finalState = this.state(plan.to);
    const isTerminal = finalState?.type === "terminal" || finalState?.terminal === true;
    if (isTerminal && this.definition.crm?.onTerminal?.length) {
      const planner: ApplyPlan = plan;
      for (const effect of this.definition.crm.onTerminal) {
        const fn = this.deps.effects.get(effect.key);
        if (!fn) throw new AppError("INTERNAL", `افکت «${effect.key}» پیاده‌سازی نشده است`);
        fn({
          runtime,
          plan: planner,
          actor,
          reason,
          payload,
          now: input.now ?? new Date(),
          transition: tr,
          option,
          params: (effect.params ?? {}) as Record<string, unknown>,
          settings: runtime.settings,
        });
        planner.traces.push({ key: effect.key, params: effect.params, summary: "crm.onTerminal" });
      }
      plan.casePatch.outcome = finalState?.outcome ?? plan.casePatch.outcome ?? null;
      plan.casePatch.status = finalState?.outcome === "aborted" || finalState?.outcome === "rejected" ? "closed" : "closed";
    }

    return plan;
  }
}

export function mergeCasePatch(a: ApplyPlan["casePatch"], b: ApplyPlan["casePatch"]): ApplyPlan["casePatch"] {
  return {
    ...a,
    ...b,
    attempts: { ...(a.attempts ?? {}), ...(b.attempts ?? {}) },
    contractPatch: { ...(a.contractPatch ?? {}), ...(b.contractPatch ?? {}) },
    listingPatch: b.listingPatch !== undefined ? b.listingPatch : (a.listingPatch ?? null),
    requirementPatch: b.requirementPatch !== undefined ? b.requirementPatch : (a.requirementPatch ?? null),
    serviceData: { ...(a.serviceData ?? {}), ...(b.serviceData ?? {}) },
  };
}
