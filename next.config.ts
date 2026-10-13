import type { NextConfig } from "next";

/**
 * پیکربندی Next.js
 * - output: standalone برای ایمیج داکر سبک (استقرار روی سرور کارفرما)
 * - allowedDevOrigins: پیش‌نمایش زنده Arena و هر دامنه اضافه از متغیر محیطی
 * - headers: جلوگیری از اشکال‌زدایی و نشت نشست؛ اجازهٔ نمایش داخل iframe فقط برای
 *   دامنه‌های صریحاً مجاز (پیش‌نمایش زنده) و دامنهٔ خودِ سامانه.
 *
 * نکته استقرار روی سرور اختصاصی: اگر پنل باید روی دامنهٔ مشخصی داخل iframe نمایش
 * داده شود، آدرس آن را در متغیر FRAME_ANCESTORS بگذارید؛ برای غیرفعال‌کردن کامل
 * قاب‌بندی، مقدار FRAME_ANCESTORS='none' را بدهید.
 */
const devOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "*.e2b.app,*.arena.ai")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** ساخت فهرست مجاز frame-ancestors از دامنه‌های محیطی (پشتیبانی از پیشوند *.) */
function buildFrameAncestors(): string {
  const raw = process.env.FRAME_ANCESTORS;
  if (raw && raw.trim().length > 0) {
    if (raw.trim() === "none") return "'none'";
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ");
  }
  const extras = devOrigins.map((host) => (host.includes("://") ? host : `https://${host}`));
  return ["'self'", ...extras].join(" ");
}

const frameAncestors = buildFrameAncestors();

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  allowedDevOrigins: devOrigins,
  serverExternalPackages: [],
  experimental: {
    // Server Actions پشت پروکسی پیش‌نمایش (Host متفاوت از Origin)
    serverActions: { allowedOrigins: devOrigins },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // X-Frame-Options عمداً تنظیم نمی‌شود (مرورگرهای قدیمی را قفل می‌کرد)؛
          // محدودیت قاب‌بندی با CSP frame-ancestors و به‌صورت قابل‌تنظیم اعمال می‌شود.
          { key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors}` },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
