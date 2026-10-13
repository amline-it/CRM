/**
 * توابع خالص چیدمان ستون‌های کانبان — بدون هیچ وابستگی به دیتابیس/سرور.
 *
 * این ماژول عمداً جدا است تا هم کامپوننت کلاینت (بدون کشیده‌شدن `node:sqlite` به
 * باندل مرورگر) و هم سرویس سرور بتوانند از یک منطق استفاده کنند؛ منطق جابه‌جایی
 * ستون‌ها در تست‌های vitest پوشش دارد.
 *
 * جابه‌جایی ستون‌ها **فقط** با درگ‌انددراپ انجام می‌شود (دکمه‌های یک‌گامه حذف شده‌اند).
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
