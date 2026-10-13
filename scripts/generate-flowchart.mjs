#!/usr/bin/env node
/**
 * تولید نمودار Mermaid از تعریف‌های گردش‌کار (منبع حقیقت = workflow-definitions/*.json).
 * استفاده: node --no-warnings scripts/generate-flowchart.mjs [مسیر خروجی]
 * پیش‌فرض خروجی: docs/superpowers/specs/2026-10-13-crm-flowchart.mmd
 */
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const definitionsDir = path.join(projectRoot, "workflow-definitions");
const outPath = process.argv[2] ?? path.join(projectRoot, "docs/superpowers/specs/2026-10-13-crm-flowchart.mmd");

const files = fs.readdirSync(definitionsDir).filter((f) => /\.v\d+\.json$/.test(f)).sort();
const lines = [];
lines.push("---");
lines.push("title: نمودار گردش‌کار CRM املاک (تولیدشده از workflow-definitions/*.json)");
lines.push("---");
lines.push("flowchart TD");
lines.push("  classDef start fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a;");
lines.push("  classDef terminal fill:#dcfce7,stroke:#15803d,color:#14532d;");
lines.push("  classDef decision fill:#fef3c7,stroke:#b45309,color:#78350f;");
lines.push("  classDef errorState fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d;");

for (const file of files) {
  const def = JSON.parse(fs.readFileSync(path.join(definitionsDir, file), "utf8"));
  lines.push("");
  lines.push(`  subgraph SG_${def.key}["${def.name}"]`);
  lines.push("    direction TB");

  for (const state of def.states) {
    const label = `${state.name}<br/><span style='font-size:10px'>${state.key}</span>`;
    const cls =
      state.type === "start" || state.key === def.initial
        ? "start"
        : state.terminal
          ? "terminal"
          : state.type === "decision"
            ? "decision"
            : state.type === "error"
              ? "errorState"
              : null;
    lines.push(`    ${state.key}["${label}"]${cls ? `:::${cls}` : ""}`);
  }

  for (const transition of def.transitions) {
    const froms = Array.isArray(transition.from) ? transition.from : [transition.from];
    const arrow = transition.kind === "auto" ? "-->" : transition.kind === "choice" ? "==>" : "-->";
    const tag = transition.kind === "auto" ? "⚙" : transition.kind === "choice" ? "◆" : "▶";
    if (transition.kind === "choice" && Array.isArray(transition.options)) {
      for (const option of transition.options) {
        lines.push(`    ${froms.join(" & ")} ${arrow}|"${tag} ${option.label}"| ${option.to}`);
      }
      continue;
    }
    if (transition.to) {
      lines.push(`    ${froms.join(" & ")} ${arrow}|"${tag} ${transition.name}"| ${transition.to}`);
    }
  }
  lines.push("  end");
}

lines.push("");
lines.push("  %% راهنما: ▶ گذار کاربری (action) · ◆ گذار انتخابی (choice) · ⚙ گذار خودکار موتور (auto)");
lines.push("  %% رنگ‌ها: آبی=شروع · سبز=پایان · زرد=تصمیم · قرمز=مسیر خطا");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

const summary = files
  .map((file) => {
    const def = JSON.parse(fs.readFileSync(path.join(definitionsDir, file), "utf8"));
    return `${def.key}: ${def.states.length} حالت، ${def.transitions.length} گذار`;
  })
  .join(" | ");
console.log(`[flowchart] نوشته شد: ${outPath}`);
console.log(`[flowchart] ${summary}`);
