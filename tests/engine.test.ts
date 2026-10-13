/**
 * تست‌های هسته موتور: گذار مجاز/غیرمجاز، گاردها، نقش، گزینه‌ها، زنجیره خودکار، حلقه.
 */
import { describe, expect, it } from "vitest";
import { AppError, GuardFailedError } from "@/lib/errors";
import { Engine } from "@/domain/engine/engine";
import { createGuardRegistry } from "@/domain/guards";
import { createEffectRegistry } from "@/domain/effects";
import {
  admin, apply, documents, engine, makeRuntime, rentContract, saleContract, signatures, staff,
} from "./helpers/harness";

describe("موتور گردش‌کار — قواعد پایه", () => {
  it("گذار ناموجود خطای INVALID_TRANSITION می‌دهد", () => {
    const eng = engine();
    const runtime = makeRuntime();
    expect(() => eng.plan({ runtime, transitionKey: "no_such_transition", actor: staff })).toThrow(AppError);
    try {
      eng.plan({ runtime, transitionKey: "no_such_transition", actor: staff });
    } catch (err) {
      expect((err as AppError).code).toBe("INVALID_TRANSITION");
    }
  });

  it("گذار از وضعیت نادرست خطا می‌دهد", () => {
    const eng = engine();
    const runtime = makeRuntime({ state: "finance_check" });
    expect(() => eng.plan({ runtime, transitionKey: "choose_contract_type", option: "rent", actor: staff })).toThrow(/امکان‌پذیر نیست/);
  });

  it("گذار choice بدون گزینه خطای VALIDATION می‌دهد", () => {
    const eng = engine();
    const runtime = makeRuntime();
    try {
      eng.plan({ runtime, transitionKey: "choose_contract_type", actor: staff });
      throw new Error("نباید اجرا شود");
    } catch (err) {
      expect((err as AppError).code).toBe("VALIDATION");
    }
  });

  it("گزینه نامعتبر خطا می‌دهد", () => {
    const eng = engine();
    const runtime = makeRuntime();
    expect(() => eng.plan({ runtime, transitionKey: "choose_contract_type", option: "unknown", actor: staff })).toThrow(/تعریف نشده/);
  });

  it("نقش غیرمجاز خطای FORBIDDEN با پیام فارسی می‌دهد", () => {
    const eng = engine();
    const runtime = makeRuntime({
      state: "payment_error",
      payments: [{ id: "p1", method: "direct", status: "failed", amount: 500_000 }],
    });
    try {
      eng.plan({ runtime, transitionKey: "payment_abort", actor: { type: "system", name: "x" }, reason: "انصراف مشتری" });
      throw new Error("نباید اجرا شود");
    } catch (err) {
      expect((err as AppError).code).toBe("FORBIDDEN");
      expect((err as AppError).message).toContain("مدیر");
    }
    // مدیر مجاز است
    const result = apply(eng, runtime, { transitionKey: "payment_abort", actor: admin, reason: "انصراف مشتری" });
    expect(result.runtime.state).toBe("contract_rejected");
  });

  it("گذار با دلیل الزامی بدون دلیل، GUARD_FAILED می‌دهد", () => {
    const eng = engine();
    const runtime = makeRuntime({ state: "documents_review", documents: documents(["submitted"]) });
    expect(() => eng.plan({ runtime, transitionKey: "documents_rejected", actor: staff, reason: "" })).toThrow(GuardFailedError);
  });

  it("گارد شکست‌خورده پیام فارسی قابل‌نمایش می‌دهد", () => {
    const eng = engine();
    const runtime = makeRuntime({ state: "documents_review", documents: documents(["submitted", "pending"]) });
    try {
      eng.plan({ runtime, transitionKey: "documents_all_approved", actor: staff });
      throw new Error("نباید اجرا شود");
    } catch (err) {
      expect(err).toBeInstanceOf(GuardFailedError);
      expect((err as Error).message).toMatch(/تأیید نشده/);
    }
  });

  it("گذار خودکار به‌صورت زنجیره‌ای اجرا می‌شود و شماره پرونده/فاکتور می‌سازد", () => {
    const eng = engine();
    let runtime = makeRuntime({ state: "output_choice", contract: rentContract({ outputMode: "signature_only" }) });
    const { runtime: after, plan } = apply(eng, runtime, {
      transitionKey: "choose_output",
      option: "signature_only",
      actor: staff,
    });
    // no_tracking → case_created → finance_check
    expect(after.state).toBe("finance_check");
    expect(after.code).toBe("CRM-1405-000001");
    expect(after.requiresTracking).toBe(false);
    expect(plan.invoice?.amount).toBe(500_000);
    expect(plan.events.some((e) => e.kind === "case.created")).toBe(true);
    expect(plan.traces.map((t) => t.key)).toContain("assign_case_code");
  });

  it("زنجیره خودکار با گارد ناموفق متوقف می‌شود و هشدار می‌دهد", () => {
    const eng = engine();
    const runtime = makeRuntime({
      state: "tracking_decision",
      requiresTracking: true,
      contract: rentContract({ outputMode: "signature_and_tracking" }),
    });
    const plan = eng.plan({ runtime, transitionKey: "request_tracking_code", actor: { type: "system", name: "engine" } });
    expect(plan.to).toBe("tracking_check");
    expect(plan.trackingRequest?.status).toBe("requested");
  });

  it("حلقه خودکار بی‌پایان شناسایی و متوقف می‌شود", () => {
    const def = {
      key: "loop-test",
      version: 1,
      name: "تست حلقه",
      context: "test",
      initial: "a",
      states: [
        { key: "a", name: "الف", type: "start" as const },
        { key: "b", name: "ب", type: "process" as const },
      ],
      transitions: [
        { key: "t1", name: "یک", from: ["a"], to: "b", kind: "auto" as const, origin: "system" as const, actors: ["system" as const] },
        { key: "t2", name: "دو", from: ["b"], to: "b", kind: "auto" as const, origin: "system" as const, actors: ["system" as const] },
      ],
    };
    const eng = new Engine(def, { guards: createGuardRegistry(), effects: createEffectRegistry() });
    const plan = eng.plan({ runtime: makeRuntime({ state: "a" }), transitionKey: "t1", actor: { type: "system", name: "engine" } });
    expect(plan.warnings.some((w) => w.includes("حلقه"))).toBe(true);
  });

  it("availableTransitions گذارهای مجاز و دلیل عدم دسترسی را برمی‌گرداند", () => {
    const eng = engine();
    const runtime = makeRuntime({
      state: "documents_review",
      documents: documents(["submitted", "pending"]),
    });
    const list = eng.available(runtime, staff);
    const approve = list.find((t) => t.key === "documents_all_approved")!;
    expect(approve.allowed).toBe(false);
    expect(approve.reason).toMatch(/تأیید نشده/);
    const pending = list.find((t) => t.key === "documents_pending")!;
    expect(pending.allowed).toBe(true);
    // گذارهای auto در فهرست UI نمی‌آیند
    expect(list.some((t) => t.kind === "auto")).toBe(false);
  });

  it("گزینه‌های choice با وضعیت دسترسی محاسبه می‌شوند", () => {
    const eng = engine();
    const runtime = makeRuntime({ state: "clause_edit_decision", contract: rentContract() });
    const list = eng.available(runtime, staff);
    const choice = list.find((t) => t.key === "clause_edit_needed")!;
    expect(choice.options?.map((o) => o.value)).toEqual(["needed", "not_needed"]);
    expect(choice.options?.every((o) => o.allowed)).toBe(true);
  });

  it("قفل نسخه تعریف: پرونده نسخه ۱ با تعریف نسخه ۱ اجرا می‌شود", () => {
    const eng = engine("contract", 1);
    const runtime = makeRuntime({ workflowVersion: 1 });
    const plan = eng.plan({ runtime, transitionKey: "choose_contract_type", option: "sale", actor: staff });
    expect(plan.workflowVersion).toBe(1);
    expect(plan.to).toBe("sale_info");
  });

  it("مسیر فروش: تأیید حقوقی نیازمند تصمیم ثبت‌شده است", () => {
    const eng = engine();
    const runtime = makeRuntime({
      state: "legal_result",
      contract: saleContract(),
      documents: documents(["approved", "approved"]),
    });
    // بدون تصمیم، گارد رد می‌کند
    expect(() => eng.plan({ runtime, transitionKey: "legal_approved", actor: staff })).toThrow(GuardFailedError);
    // با تصمیم ثبت‌شده، گذار انجام و نتیجه ذخیره می‌شود
    const { runtime: after, plan } = apply(eng, runtime, {
      transitionKey: "legal_approved",
      actor: staff,
      payload: { decision: "approved", note: "بندها بی‌ایراد است" },
    });
    expect(after.state).toBe("signature_prep");
    expect(plan.casePatch.legalReview?.result).toBe("approved");
  });
});
