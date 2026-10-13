/**
 * بارگذاری تعریف‌های گردش‌کار از دیسک (منبع حقیقت: workflow-definitions/*.json)
 * و ساخت موتور با رجیستری‌های واقعی.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Engine } from "@/domain/engine/engine";
import { validateDefinition, type ValidationIssue } from "@/domain/engine/validate";
import { createGuardRegistry } from "@/domain/guards";
import { createEffectRegistry } from "@/domain/effects";
import type { WorkflowDefinition } from "@/domain/engine/types";

const cache = new Map<string, WorkflowDefinition>();

export function definitionsDir(): string {
  return process.env.WORKFLOW_DEFINITIONS_DIR ?? path.join(process.cwd(), "workflow-definitions");
}

export function definitionFilePath(key: string, version = 1): string {
  return path.join(definitionsDir(), `${key}.v${version}.json`);
}

export function loadDefinition(key: string, version = 1): WorkflowDefinition {
  const cacheKey = `${key}@${version}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const file = definitionFilePath(key, version);
  const raw = readFileSync(file, "utf8");
  const def = JSON.parse(raw) as WorkflowDefinition;
  cache.set(cacheKey, def);
  return def;
}

export function loadAllDefinitions(): Array<{ key: string; version: number; definition: WorkflowDefinition }> {
  const dir = definitionsDir();
  const files = readdirSync(dir).filter((f) => /\.v\d+\.json$/.test(f));
  const result: Array<{ key: string; version: number; definition: WorkflowDefinition }> = [];
  for (const file of files) {
    const match = file.match(/^(.*)\.v(\d+)\.json$/);
    if (!match) continue;
    result.push({ key: match[1], version: Number(match[2]), definition: loadDefinition(match[1], Number(match[2])) });
  }
  return result.sort((a, b) => a.key.localeCompare(b.key));
}

export const guards = createGuardRegistry();
export const effects = createEffectRegistry();

export function buildEngine(definition: WorkflowDefinition): Engine {
  return new Engine(definition, { guards, effects });
}

export function engineFor(workflowKey: string, version = 1): Engine {
  return buildEngine(loadDefinition(workflowKey, version));
}

export function validateAllDefinitions(): Record<string, ValidationIssue[]> {
  const report: Record<string, ValidationIssue[]> = {};
  for (const { key, version, definition } of loadAllDefinitions()) {
    report[`${key}@${version}`] = validateDefinition(definition, { guards, effects, checkRegistries: true });
  }
  return report;
}

export function clearDefinitionCache(): void {
  cache.clear();
}

export type { WorkflowDefinition };
