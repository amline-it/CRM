/**
 * محافظت CSRF — توکن امضاشده بدون‌حالت (stateless).
 *
 * چرا بدون کوکی؟ در استقرارهایی که پنل داخل iframe یا دامنه متفاوت باز می‌شود، مرورگر کوکی‌های
 * SameSite=Lax را روی POST نمی‌فرستد و الگوی «double-submit» بی‌دلیل شکست می‌خورد. توکن زیر
 * با HMAC امضا می‌شود و مهاجم نمی‌تواند آن را جعل کند (سیاست same-origin اجازه خواندن صفحه را نمی‌دهد).
 *
 * قالب توکن:  base64url(nonce).base64url(issuedAt).base64url(HMAC-SHA256(nonce.issuedAt))
 * اعتبار پیش‌فرض: ۲۴ ساعت.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CSRF_FIELD = "_csrf";
/** نام هدر برای مسیرهای API (به‌جای فیلد فرم) */
export const CSRF_HEADER = "x-csrf-token";
/** عمر مجاز توکن (پیش‌فرض ۲۴ ساعت) */
export const CSRF_TTL_MS = Number(process.env.CSRF_TTL_MS ?? 24 * 60 * 60 * 1000);

function secret(): string {
  const value = process.env.SESSION_SECRET ?? "";
  if (!value) throw new Error("متغیر محیطی SESSION_SECRET تنظیم نشده است");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload, "utf8").digest("base64url");
}

export function createCsrfToken(now: number = Date.now()): string {
  const nonce = randomBytes(16).toString("base64url");
  const issuedAt = String(now);
  const payload = `${nonce}.${issuedAt}`;
  return `${payload}.${sign(payload)}`;
}

export interface CsrfCheck {
  ok: boolean;
  reason?: "missing" | "malformed" | "bad_signature" | "expired";
}

/** بررسی اعتبار توکن: امضا، ساختار و تازگی */
export function verifyCsrfToken(token: string | null | undefined, now: number = Date.now()): CsrfCheck {
  if (!token) return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [nonce, issuedAtRaw, signature] = parts;
  const payload = `${nonce}.${issuedAtRaw}`;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (!safeEqual(signature, expected)) return { ok: false, reason: "bad_signature" };
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: "malformed" };
  if (now - issuedAt > CSRF_TTL_MS) return { ok: false, reason: "expired" };
  if (issuedAt - now > 60_000) return { ok: false, reason: "malformed" }; // ساعت جلوتر از سرور
  return { ok: true };
}

/** مقایسه ثابت‌زمان رشته‌ها (برای توکن/کلید) */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
