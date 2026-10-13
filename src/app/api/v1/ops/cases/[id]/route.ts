import { fail, ok, requireApiSession, findCaseOr404 } from "@/services/ops-api";
import { getCaseOps } from "@/domain/service/referral-service";
import { getConversation } from "@/domain/service/conversation-service";
import { actorOf } from "@/services/ops-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/ops/cases/:id — وضعیت عملیات + مسیر ارجاع + گفت‌وگوی داخلی پرونده.
 * دسترسی: نشست کارمند + مجوز `case.view`؛ پرونده ناموجود → 404 (نه افشای داده).
 * ?markRead=0 برای خواندن بدون به‌روزرسانی وضعیت خوانده‌شده.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession("case.view");
    const { id } = await context.params;
    findCaseOr404(id);
    const actor = actorOf(session);
    const markRead = new URL(request.url).searchParams.get("markRead") !== "0";
    return ok({
      ops: getCaseOps(id, actor),
      conversation: getConversation(id, actor, { markRead }),
    });
  } catch (err) {
    return fail(err);
  }
}
