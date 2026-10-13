import { type NextRequest } from "next/server";
import { assertMutation, fail, ok, readJson, requireApiSession } from "@/services/ops-api";
import * as Platform from "@/db/repos/platform";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/ops/notifications — صندوق اعلان داخلی کارمند جاری.
 * پارامترها: ?filter=unread|all · ?kind=… · ?case=… · ?limit=… · ?offset=…
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession("case.view");
    const params = new URL(request.url).searchParams;
    const limit = Math.min(Number(params.get("limit") ?? 30) || 30, 100);
    const offset = Math.max(Number(params.get("offset") ?? 0) || 0, 0);
    const items = Platform.listInbox(session.staff.id, {
      unreadOnly: params.get("filter") === "unread",
      kind: params.get("kind") ?? undefined,
      caseId: params.get("case") ?? undefined,
      limit,
      offset,
    });
    return ok({
      items,
      unread: Platform.countUnreadInbox(session.staff.id),
      unreadByKind: {
        mention: Platform.countUnreadInbox(session.staff.id, "mention"),
        referral: Platform.countUnreadInbox(session.staff.id, "referral.new") + Platform.countUnreadInbox(session.staff.id, "referral.queue"),
        due: Platform.countUnreadInbox(session.staff.id, "ops.overdue") + Platform.countUnreadInbox(session.staff.id, "ops.due_soon"),
      },
    });
  } catch (err) {
    return fail(err);
  }
}

/**
 * POST /api/v1/ops/notifications — علامت‌گذاری خوانده‌شده.
 * بدنه: { ids: string[] } یا { all: true } (اختیاری kind برای همه)
 */
export async function POST(request: NextRequest) {
  try {
    await assertMutation(request);
    const session = await requireApiSession("case.view");
    const payload = await readJson(request);

    if (payload.all === true) {
      const kind = typeof payload.kind === "string" ? payload.kind : undefined;
      const changed = Platform.markAllInboxRead(session.staff.id, kind);
      return ok({ marked: changed, unread: Platform.countUnreadInbox(session.staff.id) });
    }

    const ids = Array.isArray(payload.ids) ? payload.ids.filter((v): v is string => typeof v === "string").slice(0, 200) : [];
    if (!ids.length) throw new AppError("VALIDATION", "شناسه اعلان مشخص نشده است");
    let marked = 0;
    for (const id of ids) {
      if (Platform.markInboxRead(session.staff.id, id)) marked += 1;
    }
    return ok({ marked, unread: Platform.countUnreadInbox(session.staff.id) });
  } catch (err) {
    return fail(err);
  }
}
