/**
 * برچسب‌های فارسی برای وضعیت‌ها و شمارشی‌های دامنه (پنل کارمندی).
 */
import type { WorkflowDefinition } from "@/domain/engine/types";

export const CASE_STATUS_LABELS: Record<string, string> = {
  open: "باز",
  closed: "بسته",
};

export const PRIORITY_LABELS: Record<string, string> = {
  low: "کم",
  normal: "عادی",
  high: "زیاد",
  urgent: "فوری",
};

export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  pending: "در انتظار بارگذاری",
  submitted: "ثبت‌شده — در انتظار بررسی",
  incomplete: "ناقص",
  rejected: "رد‌شده",
  approved: "تأییدشده",
};

export const LISTING_STATUS_LABELS: Record<string, string> = {
  draft: "پیش‌نویس",
  pending_review: "در انتظار بررسی",
  published: "منتشرشده",
  paused: "متوقف",
  expired: "منقضی",
  closed: "بسته‌شده",
};

export const REQUIREMENT_STATUS_LABELS: Record<string, string> = {
  open: "باز",
  matched: "پیشنهاد ارائه‌شده",
  fulfilled: "تأمین‌شده",
  expired: "منقضی",
  cancelled: "لغوشده",
};

export const ACCESS_LEVEL_LABELS: Record<string, string> = {
  public: "عمومی",
  agents: "مشاوران",
  staff: "کارشناسان داخلی",
};

/**
 * وضعیت کارت در کانبان عملیات.
 * نگاشت با خواسته کسب‌وکار: `new` = ارجاع‌شده (تازه در واحد) · `cancelled` = لغوشده.
 * کلیدها همان کلیدهای موجود دیتابیس‌اند (بدون وضعیت تکراری).
 */
export const KANBAN_STATUS_LABELS: Record<string, string> = {
  new: "ارجاع‌شده",
  in_review: "در حال بررسی",
  waiting_info: "منتظر اطلاعات",
  returned_correction: "برگشت برای اصلاح",
  done: "انجام‌شده",
  cancelled: "لغوشده",
};

/** لحن (رنگ نشان) هر وضعیت کانبان برای نمایش */
export const KANBAN_STATUS_TONE: Record<string, "muted" | "info" | "warning" | "danger" | "success"> = {
  new: "muted",
  in_review: "info",
  waiting_info: "warning",
  returned_correction: "danger",
  done: "success",
  cancelled: "danger",
};

/** برچسب کوتاه برای فیلتر وضعیت */
export const KANBAN_STATUS_ORDER = ["new", "in_review", "waiting_info", "returned_correction", "done", "cancelled"] as const;

/** نوع ارجاع: به همکار یا به واحد */
export const REFERRAL_KIND_LABELS: Record<string, string> = {
  colleague: "همکار",
  unit: "واحد",
};

/** اقدامات مسئول جدید روی کارت */
export const KANBAN_ACTION_LABELS: Record<string, string> = {
  start_review: "شروع رسیدگی",
  need_info: "درخواست اطلاعات",
  return_correction: "برگشت برای اصلاح",
  rerefer: "ارجاع مجدد",
  complete: "اتمام کار",
  cancel: "لغو عملیات",
};

/** نوع رویداد در تاریخچه یکپارچه عملیات (پیام / ارجاع / رویداد سیستمی) */
export const OPS_EVENT_TYPE_LABELS: Record<string, string> = {
  message: "پیام داخلی",
  referral: "ارجاع رسمی",
  system: "رویداد سیستمی",
};

/** انواع اعلان داخلی (صندوق اعلان) */
export const INBOX_KIND_LABELS: Record<string, string> = {
  "referral.new": "ارجاع جدید به شما",
  "referral.queue": "قرارگیری در صف واحد",
  "referral.owner_changed": "تغییر مسئول عملیات",
  "referral.returned": "برگشت برای اصلاح",
  "referral.done": "پایان عملیات",
  "referral.cancelled": "لغو عملیات",
  "referral.rereferred": "اقدام مجدد روی عملیات",
  mention: "منشن همکار",
  "message.new": "پیام جدید در گفت‌وگو",
  "ops.due_soon": "نزدیک شدن سررسید",
  "ops.overdue": "عبور از مهلت رسیدگی",
};

export const INBOX_KIND_TONE: Record<string, "muted" | "info" | "warning" | "danger" | "success"> = {
  "referral.new": "info",
  "referral.queue": "warning",
  "referral.owner_changed": "muted",
  "referral.returned": "danger",
  "referral.done": "success",
  "referral.cancelled": "muted",
  "referral.rereferred": "warning",
  mention: "info",
  "message.new": "muted",
  "ops.due_soon": "warning",
  "ops.overdue": "danger",
};

/** دسته‌بندی اعلان برای فیلتر صندوق اعلان */
export const INBOX_FILTERS: Array<{ key: string; label: string; kinds: string[] }> = [
  { key: "all", label: "همه", kinds: [] },
  { key: "referral", label: "ارجاع‌ها", kinds: ["referral.new", "referral.queue", "referral.owner_changed", "referral.rereferred", "referral.returned"] },
  { key: "message", label: "پیام و منشن", kinds: ["mention", "message.new"] },
  { key: "due", label: "سررسید", kinds: ["ops.due_soon", "ops.overdue"] },
  { key: "done", label: "نتیجه عملیات", kinds: ["referral.done", "referral.cancelled"] },
];

/** نوع خدمت (دسته‌بندی) در کارت کانبان */
export const SERVICE_KIND_LABELS: Record<string, string> = {
  contract: "قرارداد",
  listing: "آگهی",
  requirements: "نیازمندی",
  custom: "سایر خدمات",
};

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  rent: "اجاره",
  sale: "خرید و فروش",
};

export const OUTPUT_MODE_LABELS: Record<string, string> = {
  signature_only: "فقط امضا",
  signature_and_tracking: "امضا + کد رهگیری",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "در انتظار",
  succeeded: "موفق",
  failed: "ناموفق",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  direct: "پرداخت مستقیم",
  subscription: "اشتراک",
  referral: "کد معافیت/ریفرال",
  free: "رایگان",
};

export const SIGNATURE_STATUS_LABELS: Record<string, string> = {
  pending: "در انتظار امضا",
  signed: "امضا شد",
  declined: "امتناع",
};

export const PARTY_LABELS: Record<string, string> = {
  landlord: "مالک (مؤجر)",
  tenant: "مستأجر",
  seller: "فروشنده",
  buyer: "خریدار",
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  open: "باز",
  in_progress: "در حال انجام",
  done: "انجام‌شده",
  cancelled: "لغوشده",
};

export const TRACKING_STATUS_LABELS: Record<string, string> = {
  requested: "درخواست ثبت‌شده",
  in_progress: "در جریان",
  error: "خطا",
  received: "کد دریافت شد",
};

export const LEGAL_RESULT_LABELS: Record<string, string> = {
  approved: "تأیید",
  needs_edit: "نیازمند ویرایش بند",
  rejected: "رد",
};

export const ENTITY_LABELS: Record<string, string> = {
  users: "کاربران",
  contracts: "قراردادها",
  listings: "آگهی‌ها",
  requirements: "نیازمندی‌ها",
  services: "خدمات",
  cases: "پرونده‌ها",
  staff: "کارشناسان",
};

export const SYNC_CHANNEL_LABELS: Record<string, string> = {
  push: "دریافت (Push)",
  pull: "واکشی (Pull)",
  webhook: "وب‌هوک",
};

export const SYNC_DIRECTION_LABELS: Record<string, string> = {
  in: "دریافت از سرور اصلی",
  out: "ارسال به سرور اصلی",
};

export const SYNC_STATUS_LABELS: Record<string, string> = {
  ok: "موفق",
  partial: "نیمه‌موفق",
  failed: "ناموفق",
};

export const WEBHOOK_STATUS_LABELS: Record<string, string> = {
  pending: "در صف",
  failed: "ناموفق (تلاش دوباره)",
  delivered: "تحویل‌شده",
  dead: "ناموفق نهایی",
};

export const USER_TYPE_LABELS: Record<string, string> = {
  normal: "کاربر عادی",
  agent: "مشاور املاک",
};

export const STAFF_ROLE_LABELS: Record<string, string> = {
  staff: "کارشناس",
  admin: "مدیر",
};

export const SERVICE_CATEGORY_LABELS: Record<string, string> = {
  contract: "قرارداد",
  listing: "آگهی",
  requirements: "نیازمندی",
  custom: "خدمت سفارشی",
};

export const NOTIFICATION_CHANNEL_LABELS: Record<string, string> = {
  sms: "پیامک",
  email: "ایمیل",
  inapp: "داخل سامانه",
};

/** برچسب وضعیت پرونده از تعریف گردش‌کار */
export function stateLabel(definition: WorkflowDefinition | null | undefined, key: string): string {
  const state = definition?.states.find((s) => s.key === key);
  return state?.name ?? key;
}

/** برچسب گذار از تعریف گردش‌کار */
export function transitionLabel(definition: WorkflowDefinition | null | undefined, key: string): string {
  const tr = definition?.transitions.find((t) => t.key === key);
  return tr?.name ?? key;
}

export function labelOf(map: Record<string, string>, key: string | null | undefined, fallback = "—"): string {
  if (!key) return fallback;
  return map[key] ?? key;
}
