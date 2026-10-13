/**
 * آداپتورهای بیرونی: پرداخت، کد رهگیری، پیام‌رسانی.
 * فاز ۱ با پیاده‌سازی sandbox/manual/log؛ سوئیچ به سرویس واقعی فقط با متغیر محیطی.
 */
import { newId, randomToken } from "@/lib/ids";

/* ── پرداخت ───────────────────────────────────────────────────────── */

export interface PaymentIntent {
  caseId: string;
  amount: number;
  method: "direct" | "subscription" | "referral" | "free";
  description?: string;
}

export interface PaymentResult {
  status: "succeeded" | "failed" | "pending";
  provider: string;
  providerRef: string | null;
  error?: string | null;
  paidAt?: string | null;
}

export interface PaymentProvider {
  readonly name: string;
  charge(intent: PaymentIntent): PaymentResult;
}

export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = "sandbox";
  /**
   * شبیه‌ساز: پرداخت روش‌های اشتراک/ریفرال/رایگان همیشه موفق است؛
   * پرداخت مستقیم با مقدارهای خاص قابل کنترل است (برای تست‌ها و دمو).
   */
  charge(intent: PaymentIntent): PaymentResult {
    if (intent.method !== "direct") {
      return { status: "succeeded", provider: this.name, providerRef: `SBX-${randomToken(6)}`, paidAt: new Date().toISOString() };
    }
    return {
      status: "succeeded",
      provider: this.name,
      providerRef: `SBX-${randomToken(8)}`,
      paidAt: new Date().toISOString(),
    };
  }

  /** شبیه‌سازی پرداخت ناموفق — برای تست سناریوهای خطا و دمو */
  fail(intent: PaymentIntent, error = "پرداخت توسط کاربر لغو شد"): PaymentResult {
    return { status: "failed", provider: this.name, providerRef: null, error };
  }
}

export class ZarinpalPlaceholderProvider implements PaymentProvider {
  readonly name = "zarinpal";
  charge(): PaymentResult {
    return {
      status: "failed",
      provider: this.name,
      providerRef: null,
      error: "آداپتور زرین‌پال هنوز پیکربندی نشده است (کلید درگاه را در .env تنظیم کنید)",
    };
  }
}

export function paymentProvider(): PaymentProvider {
  const kind = process.env.PAYMENT_PROVIDER ?? "sandbox";
  if (kind === "zarinpal") return new ZarinpalPlaceholderProvider();
  return new SandboxPaymentProvider();
}

/* ── کد رهگیری ────────────────────────────────────────────────────── */

export interface TrackingRequestInput {
  caseId: string;
  code?: string | null;
  contractType?: "rent" | "sale" | null;
  parties?: string | null;
}

export interface TrackingProviderResult {
  accepted: boolean;
  reference: string | null;
  message: string;
}

export interface TrackingProvider {
  readonly name: string;
  /** ارسال درخواست به سامانه؛ در فاز ۱ فقط صف داخلی + پیام راهنما */
  submit(input: TrackingRequestInput): TrackingProviderResult;
}

export class ManualTrackingProvider implements TrackingProvider {
  readonly name = "manual";
  submit(input: TrackingRequestInput): TrackingProviderResult {
    return {
      accepted: true,
      reference: newId("TRK"),
      message: `درخواست کد رهگیری پرونده ${input.caseId} در صف کارشناس ثبت شد؛ پس از دریافت کد از سامانه املاک، آن را در پنل ثبت کنید.`,
    };
  }
}

export function trackingProvider(): TrackingProvider {
  return new ManualTrackingProvider();
}

/* ── پیام‌رسانی ───────────────────────────────────────────────────── */

export interface NotificationInput {
  channel: "sms" | "email" | "inapp";
  to?: string | null;
  body: string;
  template: string;
}

export interface NotificationResult {
  status: "sent" | "failed";
  provider: string;
  error?: string | null;
}

export interface NotificationProvider {
  readonly name: string;
  send(input: NotificationInput): NotificationResult;
}

export class LogNotificationProvider implements NotificationProvider {
  readonly name = "log";
  send(input: NotificationInput): NotificationResult {
    // در فاز ۱ پیام‌ها در پنل («پیام‌های ارسالی») و لاگ سرور ثبت می‌شوند
    if (process.env.NODE_ENV !== "test") {
      console.log(`[notification:${input.channel}] ${input.template} → ${input.body}`);
    }
    return { status: "sent", provider: this.name, error: null };
  }
}

export function notificationProvider(): NotificationProvider {
  const kind = process.env.NOTIFICATION_PROVIDER ?? "log";
  if (kind === "kavenegar" || kind === "smtp") {
    // جای سوئیچ: کلید در .env؛ در نبود کلید، لاگ می‌ماند
    if (!process.env.SMS_API_KEY && !process.env.SMTP_URL) return new LogNotificationProvider();
  }
  return new LogNotificationProvider();
}
