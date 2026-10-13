import { NextResponse, type NextRequest } from "next/server";
import { ensureMigrated } from "@/db/migrate";
import { safeEqual } from "@/auth/csrf";
import { sweepDueOps } from "@/domain/service/ops-notify";
import * as Platform from "@/db/repos/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * زمان‌بند اعلان‌های عملیات (هم‌الگو با سایر jobهای سینک).
 * POST /api/v1/ops/jobs/ops-reminders  با هدر X-Sync-Key
 * اجرای مکرر اعلان تکراری نمی‌سازد (dedupe روزانه per پرونده).
 */
export async function POST(request: NextRequest) {
  ensureMigrated();
  const expected = process.env.SYNC_API_KEY ?? "";
  if (!expected || !safeEqual(request.headers.get("x-sync-key") ?? "", expected)) {
    return NextResponse.json({ ok: false, message: "کلید سینک نامعتبر است" }, { status: 401 });
  }
  const url = new URL(request.url);
  const windowHours = Number(url.searchParams.get("windowHours") ?? 24);
  const result = sweepDueOps(new Date(), Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24);
  Platform.writeAudit({
    actorType: "system",
    actorId: null,
    actorName: "cron",
    action: "ops.reminders",
    entityType: "case",
    entityId: null,
    detail: result,
  });
  return NextResponse.json({ ok: true, ...result });
}

/** بررسی هم‌پیکربندی بودن مسیر بدون افشای داده */
export async function GET() {
  return NextResponse.json({
    ok: true,
    job: "ops-reminders",
    configured: Boolean(process.env.SYNC_API_KEY),
    requires: ["X-Sync-Key"],
    method: "POST",
    query: { windowHours: 24 },
  });
}
