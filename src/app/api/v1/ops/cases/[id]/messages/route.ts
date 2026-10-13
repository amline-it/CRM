import { type NextRequest } from "next/server";
import {
  actorOf,
  asString,
  assertMutation,
  fail,
  findCaseOr404,
  idempotencyKey,
  ok,
  readJson,
  requireApiSession,
} from "@/services/ops-api";
import { getConversation, postMessage } from "@/domain/service/conversation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/ops/cases/:id/messages — گفت‌وگوی داخلی پرونده (پیام‌ها + منشن‌ها).
 * ?markRead=0 برای خواندن بدون علامت‌گذاری خوانده‌شده.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession("case.view");
    const { id } = await context.params;
    findCaseOr404(id);
    const markRead = new URL(request.url).searchParams.get("markRead") !== "0";
    return ok(getConversation(id, actorOf(session), { markRead }));
  } catch (err) {
    return fail(err);
  }
}

/**
 * POST /api/v1/ops/cases/:id/messages — ارسال پیام داخلی با منشن اختیاری.
 * بدنه: { body: string, mentionStaffIds?: string[] }
 * منشن فقط اعلان می‌سازد و مسئولیت عملیات را منتقل نمی‌کند.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertMutation(request);
    const session = await requireApiSession("referral.create");
    const { id } = await context.params;
    findCaseOr404(id);
    const payload = await readJson(request);

    const body = asString(payload.body, 8000);
    const mentions = Array.isArray(payload.mentionStaffIds)
      ? payload.mentionStaffIds.filter((v): v is string => typeof v === "string").slice(0, 50)
      : [];

    const result = postMessage({
      caseId: id,
      actor: actorOf(session),
      body: body ?? "",
      mentionStaffIds: mentions,
      idempotencyKey: idempotencyKey(request),
    });
    return ok(result, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
