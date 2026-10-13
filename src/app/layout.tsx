import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionBridge } from "@/components/session-bridge";

export const metadata: Metadata = {
  title: "CRM املاک",
  description: "سامانه مدیریت پرونده‌های قرارداد، آگهی و نیازمندی املاک",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <SessionBridge />
        {children}
      </body>
    </html>
  );
}
