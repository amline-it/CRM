import { NextResponse, type NextRequest } from "next/server";
import { dispatchDueWebhooks } from "@/services/sync";
import * as Platform from "@/db/repos/platform";
import { ensureMigrated } from "@/db/migrate";
import { safeEqual } from "@/auth/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request: NextRequest): boolean {
  const expected = process.env.SYNC_API_KEY ?? "";
  if (!expected) return false;
  const provided = request.headers.get("x-sync-key") ?? "";
  return safeEqual(provided, expected);
}

/** زمان‌بند (cron) سرور اصلی یا cron سیستم: ارسال وب‌هوک‌های سررسیده */
export async function POST(request: NextRequest) {
  ensureMigrated();
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, message: "کلید سینک نامعتبر است" }, { status: 401 });
  }
  const limitParam = Number(new URL(request.url).searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;
  const results = await dispatchDueWebhooks(limit);
  Platform.writeAudit({
    actorType: "system",
    actorId: null,
    actorName: "cron",
    action: "sync.dispatch_webhooks",
    entityType: "webhook",
    entityId: "scheduled",
    detail: { total: results.length, ok: results.filter((r) => r.ok).length },
  });
  return NextResponse.json({
    ok: true,
    processed: results.length,
    delivered: results.filter((r) => r.ok).length,
    results,
  });
}

export async function GET() {
  const pending = Platform.listWebhooks(200).filter((hook) => hook.status === "pending" || hook.status === "failed");
  const dead = Platform.listWebhooks(200).filter((hook) => hook.status === "dead");
  return NextResponse.json({ ok: true, pending: pending.length, dead: dead.length });
}
