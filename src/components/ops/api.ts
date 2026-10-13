"use client";

/**
 * لایه فراخوانی API عملیات از سمت مرورگر.
 * - نشست با کوکی/هدر همان پنل فرستاده می‌شود (credentials: same-origin).
 * - برای درخواست‌های تغییردهنده، توکن CSRF در هدر `X-CSRF-Token` می‌رود.
 * - `Idempotency-Key` اختیاری است تا دوبار کلیک/تلاش دوباره، ارجاع یا اعلان تکراری نسازد.
 * - UI تا تأیید سرور تغییری نشان نمی‌دهد؛ در خطا همان وضعیت قبلی معتبر می‌ماند.
 */

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  code: string;
  message: string;
  hint?: string;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function opsFetch<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; csrf?: string; idempotencyKey?: string } = {},
): Promise<ApiResult<T>> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.csrf) headers["X-CSRF-Token"] = options.csrf;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  try {
    const response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; data?: T; message?: string; code?: string; hint?: string }
      | null;
    if (!payload) {
      return { ok: false, code: "INTERNAL", message: "پاسخ سرور قابل خواندن نبود" };
    }
    if (response.ok && payload.ok) return { ok: true, data: payload.data as T };
    return {
      ok: false,
      code: payload.code ?? String(response.status),
      message: payload.message ?? "خطای نامشخص سرور",
      hint: payload.hint,
    };
  } catch (err) {
    return {
      ok: false,
      code: "NETWORK",
      message: `ارتباط با سرور برقرار نشد${err instanceof Error ? ` (${err.message})` : ""}`,
    };
  }
}
