import { type NextRequest } from "next/server";
import { actorOf, asString, assertMutation, fail, ok, readJson, requireApiSession } from "@/services/ops-api";
import { deleteMessage, editMessage } from "@/domain/service/conversation-service";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/v1/ops/messages/:id — ویرایش پیام (فقط نویسنده یا مدیر).
 * متن قبلی در audit_log نگه داشته می‌شود؛ تاریخچه حسابرسی پاک نمی‌شود.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertMutation(request);
    const session = await requireApiSession("referral.create");
    const { id } = await context.params;
    const payload = await readJson(request);
    const body = asString(payload.body, 8000);
    if (!body) throw new AppError("VALIDATION", "متن تازه پیام خالی است");
    return ok(editMessage({ messageId: id, actor: actorOf(session), body }));
  } catch (err) {
    return fail(err);
  }
}

/** DELETE /api/v1/ops/messages/:id — حذف نرم پیام (ردیف برای حسابرسی می‌ماند) */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertMutation(request);
    const session = await requireApiSession("referral.create");
    const { id } = await context.params;
    return ok(deleteMessage({ messageId: id, actor: actorOf(session) }));
  } catch (err) {
    return fail(err);
  }
}
