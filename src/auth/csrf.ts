/**
 * محافظت CSRF — الگوی double-submit: توکن تصادفی در کوکی + فیلد پنهان فرم.
 * توکن در هر رندر فرم به‌صورت سمت‌سرور در فرم قرار می‌گیرد و در اکشن بررسی می‌شود.
 */
import { timingSafeEqual } from "node:crypto";
import { randomBytes } from "node:crypto";

export const CSRF_COOKIE = "crm_csrf";
export const CSRF_FIELD = "_csrf";

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
