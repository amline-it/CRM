/**
 * چیدمان ستون‌های تخته کانبان عملیات.
 *
 * مبنا همان مدل موجود است و جدول موازی ساخته نمی‌شود:
 *   ۱) **ترتیب پیش‌فرض تیم** = `org_units.sort_order` (همان فیلدی که فرم «مدیریت واحدها» ویرایش می‌کند).
 *   ۲) **ترتیب شخصی هر کارمند** = یک ردیف در جدول `settings` با کلید `ops.board.columns.<staffId>`.
 *
 * قواعد:
 *   - هر کارمند می‌تواند ستون‌های خودش را بچیند؛ این تغییر روی دیدن دیگران اثر ندارد.
 *   - مدیر می‌تواند چیدمان فعلی را «ترتیب پیش‌فرض همه» کند (روی `sort_order` واحدها).
 *   - کلید ناشناخته در ترتیب ذخیره‌شده نادیده گرفته می‌شود (واحد حذف‌شده چیدمان را خراب نکند) و
 *     واحد تازه به انتهای ترتیب می‌آید؛ پس همیشه همه ستون‌ها دیده می‌شوند.
 *   - ورودی API سخت‌گیرانه اعتبارسنجی می‌شود (کلید تکراری/ناشناخته → خطای روشن).
 */
import { AppError } from "@/lib/errors";
import { transaction } from "@/db/client";
import * as Platform from "@/db/repos/platform";
import * as Referrals from "@/db/repos/referrals";
import type { ActorContext } from "@/domain/engine/types";
import type { OrgUnitRow } from "@/db/repos/referrals";

/** پیشوند کلید تنظیمات ترتیب شخصی */
export const COLUMN_ORDER_SETTING_PREFIX = "ops.board.columns.";
/** سقف تعداد ستون‌ها (محافظت از تنظیمات/درخواست دست‌کاری‌شده) */
export const MAX_COLUMNS = 60;
/** گام شماره‌گذاری sort_order تا درج بین دو واحد آسان بماند */
const SORT_STEP = 10;

export type ColumnOrderSource = "personal" | "default";

export function columnOrderSettingKey(staffId: string): string {
  return `${COLUMN_ORDER_SETTING_PREFIX}${staffId}`;
}

/* ── اعتبارسنجی و ادغام ───────────────────────────────────────────── */

/**
 * نرمال‌سازی مقدار ذخیره‌شده در تنظیمات: رشته‌های غیرخالی، بدون تکرار، با سقف تعداد.
 * مقدار نامعتبر → null (یعنی «ترتیب شخصی وجود ندارد»).
 */
export function normalizeColumnOrder(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const key = item.trim();
    if (!key || out.includes(key)) continue;
    out.push(key);
    if (out.length >= MAX_COLUMNS) break;
  }
  return out.length ? out : null;
}

/** ورودی API: باید آرایه‌ای از کلیدهای یکتا باشد، وگرنه خطای روشن */
export function parseColumnOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new AppError("VALIDATION", "ترتیب ستون‌ها باید آرایه‌ای از کلید واحدها باشد");
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) {
      throw new AppError("VALIDATION", "کلید واحد در ترتیب ستون‌ها نامعتبر است");
    }
    const key = item.trim();
    if (out.includes(key)) throw new AppError("VALIDATION", `کلید تکراری در ترتیب ستون‌ها: ${key}`);
    out.push(key);
  }
  if (!out.length) throw new AppError("VALIDATION", "ترتیب ستون‌ها خالی است");
  if (out.length > MAX_COLUMNS) throw new AppError("VALIDATION", "تعداد ستون‌ها بیش از حد مجاز است");
  return out;
}

/**
 * اعمال ترتیب دلخواه روی فهرست واحدها:
 * ابتدا کلیدهای شناخته‌شده به همان ترتیب، سپس بقیه واحدها (به ترتیب فعلی خودشان).
 */
export function mergeColumnOrder<T extends { key: string }>(units: T[], preferred: string[] | null | undefined): T[] {
  if (!preferred?.length) return [...units];
  const byKey = new Map(units.map((unit) => [unit.key, unit]));
  const ordered: T[] = [];
  for (const key of preferred) {
    const unit = byKey.get(key);
    if (!unit) continue; // کلید ناشناخته/حذف‌شده نادیده گرفته می‌شود
    ordered.push(unit);
    byKey.delete(key);
  }
  for (const unit of units) {
    if (byKey.has(unit.key)) ordered.push(unit);
  }
  return ordered;
}

/* ── ترتیب شخصی ───────────────────────────────────────────────────── */

/** ترتیب شخصی ذخیره‌شده یک کارمند (یا null) */
export function readPersonalColumnOrder(staffId: string | null | undefined): string[] | null {
  if (!staffId) return null;
  return normalizeColumnOrder(Platform.getSetting<unknown>(columnOrderSettingKey(staffId), null));
}

/** ذخیره ترتیب شخصی؛ همه کلیدها باید واحد موجود باشند */
export function savePersonalColumnOrder(staffId: string, order: string[]): string[] {
  assertKnownUnits(order);
  Platform.setSetting(columnOrderSettingKey(staffId), order);
  return order;
}

export function clearPersonalColumnOrder(staffId: string): void {
  Platform.setSetting(columnOrderSettingKey(staffId), null);
}

/* ── ترتیب پیش‌فرض تیم ────────────────────────────────────────────── */

function assertKnownUnits(order: string[]): void {
  const known = new Set(Referrals.listOrgUnits().map((unit) => unit.key));
  const unknown = order.filter((key) => !known.has(key));
  if (unknown.length) throw new AppError("VALIDATION", `واحد ناشناخته در ترتیب ستون‌ها: ${unknown.join(", ")}`);
}

/**
 * ترتیب پیش‌فرض تیم را روی `sort_order` واحدها می‌نویسد.
 * واحدهایی که در ورودی نیامده‌اند، ترتیب فعلی خود را پس از فهرست داده‌شده حفظ می‌کنند.
 */
export function saveDefaultColumnOrder(order: string[]): string[] {
  assertKnownUnits(order);
  const units = Referrals.listOrgUnits();
  const byKey = new Map(units.map((unit) => [unit.key, unit]));
  const seen = new Set(order);
  const applied = [...order.map((key) => byKey.get(key)!), ...units.filter((unit) => !seen.has(unit.key))];
  transaction(() => {
    applied.forEach((unit, index) => {
      Referrals.updateOrgUnit(unit.id, { sortOrder: (index + 1) * SORT_STEP });
    });
  });
  return applied.map((unit) => unit.key);
}

/** بازنشانی ترتیب پیش‌فرض به ترتیب ساخت واحدها (رفتار اولیه سامانه) */
export function resetDefaultColumnOrder(): string[] {
  const units = [...Referrals.listOrgUnits()].sort((a, b) =>
    a.created_at === b.created_at ? a.name.localeCompare(b.name, "fa") : a.created_at.localeCompare(b.created_at),
  );
  return saveDefaultColumnOrder(units.map((unit) => unit.key));
}

/* ── وضعیت نهایی چیدمان ───────────────────────────────────────────── */

export interface ColumnLayout {
  /** ترتیب مؤثر کلیدها برای این کارمند (همه واحدها، بدون تکرار) */
  order: string[];
  source: ColumnOrderSource;
  personalOrder: string[] | null;
  units: OrgUnitRow[];
}

/**
 * چیدمان مؤثر برای یک کارمند: ترتیب شخصی (اگر معتبر باشد) وگرنه ترتیب پیش‌فرض واحدها.
 */
export function columnLayout(staffId: string | null | undefined): ColumnLayout {
  const units = Referrals.listOrgUnits();
  const personalOrder = readPersonalColumnOrder(staffId);
  const merged = mergeColumnOrder(units, personalOrder);
  const appliedPersonal = Boolean(personalOrder?.length);
  return {
    order: merged.map((unit) => unit.key),
    source: appliedPersonal ? "personal" : "default",
    personalOrder,
    units: merged,
  };
}

/** تنها مدیر می‌تواند ترتیب پیش‌فرض همه را تغییر دهد */
export function canSetDefaultColumnOrder(actor: ActorContext): boolean {
  return actor.type === "admin";
}
