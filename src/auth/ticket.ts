/**
 * استخراج توکن نشست از هدرها — ماژول خالص (بدون وابستگی به Next)، قابل تست واحد.
 *
 * این مسیر برای محیط‌هایی است که کوکی ذخیره/ارسال نمی‌شود:
 * پنل داخل iframe، مرورگرهایی که کوکی شخص‌ثالث را مسدود می‌کنند، یا پروکسی‌های سخت‌گیر.
 */
export const SESSION_TICKET_HEADER = "x-session-ticket";
export const SESSION_AUTH_HEADER = "authorization";

/** با ALLOW_HEADER_SESSION=false می‌توان پذیرش توکن از هدر را کامل خاموش کرد */
export function headerSessionEnabled(): boolean {
  return process.env.ALLOW_HEADER_SESSION !== "false";
}

/** اولویت: هدر اختصاصی، سپس Authorization: Bearer */
export function ticketFromHeaders(headerList: { get(name: string): string | null }): string | null {
  const direct = headerList.get(SESSION_TICKET_HEADER);
  if (direct?.trim()) return direct.trim();
  const auth = headerList.get(SESSION_AUTH_HEADER);
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim() || null;
  return null;
}
