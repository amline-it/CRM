/**
 * خطاهای ساخت‌یافته — کد ماشینی + پیام فارسی، بدون استثنای خام در مسیر کاربر.
 */
export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "GUARD_FAILED"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "SYNC_AUTH"
  | "SYNC_INVALID"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
  readonly hint?: string;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { httpStatus?: number; details?: Record<string, unknown>; hint?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = opts.httpStatus ?? defaultStatus(code);
    this.details = opts.details;
    this.hint = opts.hint;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case "VALIDATION":
    case "SYNC_INVALID":
      return 400;
    case "UNAUTHORIZED":
    case "SYNC_AUTH":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "GUARD_FAILED":
    case "INVALID_TRANSITION":
      return 422;
    default:
      return 500;
  }
}

/** خطای گارد — وقتی شرط عبور برقرار نیست. پیام برای نمایش مستقیم به کارمند است. */
export class GuardFailedError extends AppError {
  constructor(guardKey: string, message: string, details?: Record<string, unknown>) {
    super("GUARD_FAILED", message, { details: { guard: guardKey, ...details }, hint: "شرط عبور این گذار برقرار نیست." });
    this.name = "GuardFailedError";
  }
}

export function toErrorResponse(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof AppError) {
    return {
      status: err.httpStatus,
      body: { ok: false, code: err.code, message: err.message, details: err.details, hint: err.hint },
    };
  }
  const message = err instanceof Error ? err.message : "خطای ناشناخته";
  return { status: 500, body: { ok: false, code: "INTERNAL", message: "خطای داخلی سرور", details: { raw: message } } };
}
