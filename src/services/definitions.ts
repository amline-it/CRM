/**
 * ثبت تعریف‌های گردش‌کار (فایل‌های workflow-definitions/*.json) و خدمات پیش‌فرض در دیتابیس.
 * همان کاری که scripts/seed.mjs انجام می‌دهد، از داخل برنامه هم قابل اجراست (پنل مدیر).
 */
import * as Platform from "@/db/repos/platform";
import * as Catalog from "@/db/repos/catalog";
import { loadAllDefinitions, buildEngine, clearDefinitionCache } from "@/domain/workflows";
import { ensureMigrated } from "@/db/migrate";
import defaultServices from "@/data/default-services.json";

export interface DefaultService {
  key: string;
  name: string;
  category: string;
  workflowKey: string;
  price: number;
  requiresSubscription?: boolean;
  requiresReferral?: boolean;
  requiredDocuments?: string[];
  sortOrder?: number;
  description?: string;
}

/** خدمات پایه که با هر نصب ساخته می‌شوند (منبع: src/data/default-services.json) */
export const DEFAULT_SERVICES = defaultServices as DefaultService[];

export interface SeedReport {
  definitions: Array<{ key: string; version: number; states: number; transitions: number }>;
  services: string[];
  activated: string[];
}

/**
 * بارگذاری تعریف‌ها و خدمات در دیتابیس.
 * - تعریف‌ها با همان کلید/نسخه upsert و نسخه فایل به‌عنوان نسخه فعال علامت‌گذاری می‌شوند.
 * - خدماتی که از قبل در دیتابیس هستند دست نمی‌خورند (ویرایش‌های پنل حفظ می‌شود).
 */
export function seedDefinitions(opts: { services?: boolean } = {}): SeedReport {
  ensureMigrated();
  const report: SeedReport = { definitions: [], services: [], activated: [] };

  for (const { key, version, definition } of loadAllDefinitions()) {
    // اعتبارسنجی قبل از ثبت: تعریف خراب نباید وارد دیتابیس شود
    buildEngine(definition);
    Platform.upsertWorkflowDefinition({ key, version, name: definition.name, definition });
    const row = Platform.listWorkflows().find((w) => w.key === key && Number(w.version) === version);
    if (row && !row.active) {
      Platform.setWorkflowActive(row.id, true);
      report.activated.push(`${key}@v${version}`);
    }
    report.definitions.push({ key, version, states: definition.states.length, transitions: definition.transitions.length });
  }
  clearDefinitionCache();

  if (opts.services !== false) {
    for (const service of DEFAULT_SERVICES) {
      if (Catalog.getServiceByKey(service.key)) continue;
      Catalog.upsertService({
        key: service.key,
        name: service.name,
        category: service.category,
        workflowKey: service.workflowKey,
        description: service.description ?? null,
        price: service.price,
        requiresSubscription: service.requiresSubscription,
        requiresReferral: service.requiresReferral,
        requiredDocuments: service.requiredDocuments ?? [],
        sortOrder: service.sortOrder,
        active: true,
      });
      report.services.push(service.key);
    }
  }

  return report;
}
