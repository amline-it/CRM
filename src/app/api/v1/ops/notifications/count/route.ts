import { fail, ok, requireApiSession } from "@/services/ops-api";
import * as Platform from "@/db/repos/platform";
import * as Conv from "@/db/repos/conversations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/ops/notifications/count — شمارنده سبک اعلان‌های خوانده‌نشده
 * (برای واکشی دوره‌ای در نوار بالا؛ بدون WebSocket).
 */
export async function GET() {
  try {
    const session = await requireApiSession("case.view");
    return ok({
      unread: Platform.countUnreadInbox(session.staff.id),
      mentions: Conv.countUnreadMentions(session.staff.id),
      at: new Date().toISOString(),
    });
  } catch (err) {
    return fail(err);
  }
}
