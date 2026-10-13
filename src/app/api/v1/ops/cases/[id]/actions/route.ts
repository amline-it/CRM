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
import { actOnCard, type KanbanAction } from "@/domain/service/referral-service";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS: KanbanAction[] = ["start_review", "need_info", "return_correction", "rerefer", "complete", "cancel"];

/**
 * POST /api/v1/ops/cases/:id/actions — اقدام مسئول عملیات روی وضعیت کارت.
 * بدنه: { action, reason?, resultNote?, kind?, toStaffId?, toUnit?, priority?, dueAt? }
 * اعتبارسنجی گذار وضعیت و مجوز، سمت سرور انجام می‌شود؛ پاسخ سرور وضعیت نهایی را
 * برمی‌گرداند تا UI تا پیش از تأیید، تغییر را قطعی نشان ندهد.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertMutation(request);
    const session = await requireApiSession("referral.create");
    const { id } = await context.params;
    const caseRow = findCaseOr404(id);
    const body = await readJson(request);

    const action = typeof body.action === "string" && ACTIONS.includes(body.action as KanbanAction)
      ? (body.action as KanbanAction)
      : null;
    if (!action) throw new AppError("VALIDATION", "اقدام انتخاب‌شده معتبر نیست");

    const result = actOnCard({
      caseId: caseRow.id,
      actor: actorOf(session),
      action,
      reason: asString(body.reason, 2000),
      resultNote: asString(body.resultNote, 2000),
      kind: body.kind === "colleague" || body.kind === "unit" ? body.kind : undefined,
      toStaffId: asString(body.toStaffId, 120),
      toUnit: asString(body.toUnit, 120),
      description: asString(body.description, 4000),
      expectedOutput: asString(body.expectedOutput, 2000),
      priority: asString(body.priority, 20),
      dueAt: asString(body.dueAt, 40),
      idempotencyKey: idempotencyKey(request),
    });

    return ok(result, { status: result.replayed ? 200 : 201 });
  } catch (err) {
    return fail(err);
  }
}
