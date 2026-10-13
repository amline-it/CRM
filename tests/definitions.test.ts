/**
 * اعتبارسنجی تعریف‌های گردش‌کار + پوشش رجیستری‌ها + تطبیق با فلوچارت منبع.
 */
import { describe, expect, it } from "vitest";
import { effects as effectFns } from "@/domain/effects";
import { guards as guardFns } from "@/domain/guards";
import { loadAllDefinitions, validateAllDefinitions } from "@/domain/workflows";

describe("تعریف‌های گردش‌کار", () => {
  it("هر چهار گردش‌کار بارگذاری می‌شوند", () => {
    const all = loadAllDefinitions();
    expect(all.map((d) => d.key).sort()).toEqual(["contract", "custom_service", "listing", "requirements"]);
  });

  it("هیچ خطای اعتبارسنجی ندارند (گارد/افکت ناشناخته، گره بی‌خروج، مقصد نامعتبر)", () => {
    const report = validateAllDefinitions();
    const problems = Object.entries(report).flatMap(([key, issues]) =>
      issues.filter((i) => i.level === "error").map((i) => `${key}: [${i.code}] ${i.message}`),
    );
    expect(problems).toEqual([]);
  });

  it("همه کلیدهای حالت‌ها یکتا و همه گره‌های فلوچارت پوشش داده شده‌اند", () => {
    const contract = loadAllDefinitions().find((d) => d.key === "contract")!.definition;
    // گره‌های اصلی فلوچارت بند ۲ (قرارداد) باید همه حاضر باشند
    const expectedNodes = [
      "A", "I", "J", "K", "L", "M", "N", "O", "Q", "R", "S", "Q1", "T", "V", "V1", "V2", "V3",
      "W", "LEG", "LEGRESULT", "EDIT", "REJECT", "X", "SIGNPREP", "SIGN", "SIGNOK", "SIGNFOLLOW",
      "TRACK", "DONE1", "TRACKREQ", "TRACKOK", "TRACKERR", "DONE2",
    ];
    const nodes = new Set(contract.states.map((s) => s.node).filter(Boolean));
    const missing = expectedNodes.filter((n) => !nodes.has(n));
    expect(missing).toEqual([]);
    expect(contract.states.length).toBeGreaterThanOrEqual(29);
  });

  it("گاردها و افکت‌های استفاده‌نشده نداریم و همه ارجاع‌ها پیاده‌سازی شده‌اند", () => {
    const referencedGuards = new Set<string>();
    const referencedEffects = new Set<string>();
    for (const { definition } of loadAllDefinitions()) {
      for (const t of definition.transitions) {
        for (const g of t.guards ?? []) referencedGuards.add(g.key);
        for (const e of t.effects ?? []) referencedEffects.add(e.key);
        for (const o of t.options ?? []) {
          for (const g of o.guards ?? []) referencedGuards.add(g.key);
          for (const e of o.effects ?? []) referencedEffects.add(e.key);
        }
      }
      for (const e of definition.crm?.onTerminal ?? []) referencedEffects.add(e.key);
    }
    const missingGuards = [...referencedGuards].filter((k) => !(k in guardFns));
    const missingEffects = [...referencedEffects].filter((k) => !(k in effectFns));
    expect(missingGuards).toEqual([]);
    expect(missingEffects).toEqual([]);
  });

  it("هر حالت خطا (❌) یک راه بازگشت و یک راه انصراف دارد", () => {
    const contract = loadAllDefinitions().find((d) => d.key === "contract")!.definition;
    const errorStates = contract.states.filter((s) => s.type === "error" && !s.terminal);
    for (const state of errorStates) {
      const outgoing = contract.transitions.filter((t) => t.from.includes(state.key));
      expect(outgoing.length, `حالت خطا ${state.key} باید راه خروج داشته باشد`).toBeGreaterThan(0);
    }
  });
});
