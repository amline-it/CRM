/**
 * اعتبارسنجی تعریف گردش‌کار — پیش از فعال‌سازی نسخه.
 * خطاها هم برای تست CI و هم برای پنل مدیر (نمایش تعریف خراب) استفاده می‌شوند.
 */
import type { GuardRegistry, EffectRegistry, WorkflowDefinition } from "./types";

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  where?: string;
}

export interface ValidateOptions {
  guards?: GuardRegistry;
  effects?: EffectRegistry;
  /** بررسی شناخته‌بودن کلید گارد/افکت (در تست‌ها با رجیستری واقعی) */
  checkRegistries?: boolean;
}

export function validateDefinition(def: WorkflowDefinition, opts: ValidateOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (level: "error" | "warning", code: string, message: string, where?: string) =>
    issues.push({ level, code, message, where });

  if (!def.key) add("error", "key_missing", "کلید گردش‌کار تعیین نشده است");
  if (!Number.isInteger(def.version) || def.version < 1) add("error", "version_invalid", "نسخه باید عدد صحیح مثبت باشد");
  if (!def.name) add("error", "name_missing", "نام گردش‌کار تعیین نشده است");
  if (!def.states?.length) add("error", "states_missing", "فهرست حالت‌ها خالی است");
  if (!def.transitions?.length) add("error", "transitions_missing", "فهرست گذارها خالی است");

  const stateKeys = new Set<string>();
  for (const state of def.states ?? []) {
    if (!state.key) add("error", "state_key_missing", "حالت بدون کلید");
    if (stateKeys.has(state.key)) add("error", "state_duplicate", `حالت تکراری: ${state.key}`, state.key);
    stateKeys.add(state.key);
    if (!state.name) add("warning", "state_name_missing", `نام حالت خالی است: ${state.key}`, state.key);
  }

  if (!stateKeys.has(def.initial)) add("error", "initial_missing", `حالت شروع «${def.initial}» در فهرست حالت‌ها نیست`);

  const transitionKeys = new Set<string>();
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();

  const checkSpec = (kind: "garde" | "effect", key: string, where: string) => {
    if (!key) {
      add("error", `${kind}_key_missing`, `${kind === "garde" ? "گارد" : "افکت"} بدون کلید`, where);
      return;
    }
    if (!opts.checkRegistries) return;
    const registry = kind === "garde" ? opts.guards : opts.effects;
    if (!registry?.has(key)) {
      add("error", `${kind}_unknown`, `${kind === "garde" ? "گارد" : "افکت"} ناشناخته: ${key}`, where);
    }
  };

  for (const tr of def.transitions ?? []) {
    const where = `transition:${tr.key}`;
    if (!tr.key) add("error", "transition_key_missing", "گذار بدون کلید");
    if (transitionKeys.has(tr.key)) add("error", "transition_duplicate", `گذار تکراری: ${tr.key}`, where);
    transitionKeys.add(tr.key);
    if (!tr.name) add("warning", "transition_name_missing", `نام گذار خالی است: ${tr.key}`, where);
    if (!tr.from?.length) add("error", "transition_from_missing", `گذار ${tr.key} حالت مبدأ ندارد`, where);
    for (const from of tr.from ?? []) {
      if (!stateKeys.has(from)) add("error", "transition_from_unknown", `مبدأ ناشناخته «${from}» در ${tr.key}`, where);
      outgoing.set(from, (outgoing.get(from) ?? 0) + 1);
    }
    if (tr.kind === "choice") {
      if (!tr.options?.length) add("error", "choice_without_options", `گذار choice بدون گزینه: ${tr.key}`, where);
      for (const option of tr.options ?? []) {
        if (!option.value) add("error", "option_value_missing", `گزینه بدون مقدار در ${tr.key}`, where);
        if (!option.to || !stateKeys.has(option.to)) {
          add("error", "option_to_unknown", `مقصد گزینه «${option.to}» در ${tr.key} نامعتبر است`, where);
        }
        outgoing.set(option.to, (outgoing.get(option.to) ?? 0) + 1);
        incoming.set(option.to, (incoming.get(option.to) ?? 0) + 1);
        for (const g of option.guards ?? []) checkSpec("garde", g.key, where);
        for (const e of option.effects ?? []) checkSpec("effect", e.key, where);
      }
    } else {
      if (!tr.to || !stateKeys.has(tr.to)) add("error", "transition_to_unknown", `مقصد «${tr.to}» در ${tr.key} نامعتبر است`, where);
      if (tr.to) {
        outgoing.set(tr.to, (outgoing.get(tr.to) ?? 0) + 1);
        incoming.set(tr.to, (incoming.get(tr.to) ?? 0) + 1);
      }
    }
    if (!tr.actors?.length) add("error", "transition_actors_missing", `گذار ${tr.key} نقش مجاز ندارد`, where);
    for (const g of tr.guards ?? []) checkSpec("garde", g.key, where);
    for (const e of tr.effects ?? []) checkSpec("effect", e.key, where);
    if (tr.kind === "auto" && !(tr.actors ?? []).includes("system")) {
      add("warning", "auto_without_system", `گذار خودکار ${tr.key} نقش system ندارد`, where);
    }
  }

  for (const e of def.crm?.onTerminal ?? []) checkSpec("effect", e.key, "crm.onTerminal");

  // حالت‌های غیرپایانی باید راه خروج داشته باشند (ضد‌هدف: گیر افتادن)
  for (const state of def.states ?? []) {
    const isTerminal = state.type === "terminal" || state.terminal === true;
    const hasOutgoing = (outgoing.get(state.key) ?? 0) > 0;
    const hasIncoming = (incoming.get(state.key) ?? 0) > 0;
    if (!isTerminal && !hasOutgoing) {
      add("error", "state_dead_end", `حالت «${state.key}» (${state.name}) هیچ گذار خروجی ندارد`, state.key);
    }
    if (isTerminal && hasOutgoing) {
      add("warning", "terminal_with_outgoing", `حالت پایانی «${state.key}» گذار خروجی دارد`, state.key);
    }
    if (state.key !== def.initial && !hasIncoming) {
      add("warning", "state_unreachable", `حالت «${state.key}» ورودی ندارد و دست‌نیافتنی است`, state.key);
    }
  }

  return issues;
}

export function assertValidDefinition(def: WorkflowDefinition, opts: ValidateOptions = {}): void {
  const errors = validateDefinition(def, opts).filter((i) => i.level === "error");
  if (errors.length) {
    throw new Error(`تعریف گردش‌کار «${def.key}» نامعتبر است: ${errors.map((e) => e.message).join(" | ")}`);
  }
}
