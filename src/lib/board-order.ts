/**
 * توابع خالص چیدمان ستون‌های کانبان — بدون هیچ وابستگی به دیتابیس/سرور.
 *
 * این ماژول عمداً جدا است تا هم کامپوننت کلاینت (بدون کشیده‌شدن `node:sqlite` به
 * باندل مرورگر) و هم سرویس سرور بتوانند از یک منطق استفاده کنند؛ منطق جابه‌جایی
 * ستون‌ها در تست‌های vitest پوشش دارد.
 */

/**
 * کلید `fromKey` را «پیش از» کلید `toKey` درج می‌کند — رفتار مورد انتظار هنگام
 * رهاکردن یک ستون روی ستون دیگر. ورودی نامعتبر → همان ترتیب قبلی (بدون تغییر).
 */
export function moveColumnKey(order: string[], fromKey: string, toKey: string): string[] {
  const next = [...order];
  const from = next.indexOf(fromKey);
  const to = next.indexOf(toKey);
  if (from < 0 || to < 0 || from === to) return order;
  const [moved] = next.splice(from, 1);
  next.splice(from < to ? to - 1 : to, 0, moved);
  return next;
}

/** جابه‌جایی یک گام: راست = ابتدای تخته (چیدمان RTL)، چپ = انتهای تخته */
export function shiftColumnKey(order: string[], key: string, direction: "right" | "left"): string[] {
  const index = order.indexOf(key);
  if (index < 0) return order;
  const target = direction === "right" ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return order;
  const next = [...order];
  next.splice(target, 0, next.splice(index, 1)[0]);
  return next;
}
