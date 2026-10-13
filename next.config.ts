import type { NextConfig } from "next";

/**
 * پیکربندی Next.js
 * - output: standalone برای ایمیج داکر سبک (استقرار روی سرور کارفرما)
 * - allowedDevOrigins: پیش‌نمایش زنده Arena و هر دامنه اضافه از متغیر محیطی
 */
const devOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "*.e2b.app,*.arena.ai")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
