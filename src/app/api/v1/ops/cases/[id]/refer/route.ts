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
import { referCase } from "@/domain/service/referral-service";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/ops/cases/:id/refer — ارجاع عملیات به همکار یا واحد سازمانی.
 * هدرها: X-CSRF-Token (الزامی) · Idempotency-Key (اختیاری، جلوگیری از ارجاع تکراری)
 * بدنه: { kind: "colleague" | "unit", toStaffId?, toUnit?, reason?, description?,
 *         expectedOutput?, priority?, dueAt?, note? }
 * مجوز: `referral.create` + مسئول بودن در واحد جاری (یا مدیر) — بررسی سمت سرور.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertMutation(request);
    const session = await requireApiSession("referral.create");
    const { id } = await context.params;
    const caseRow = findCaseOr404(id);
    const body = await readJson(request);

    const kind = body.kind === "colleague" || body.kind === "unit" ? body.kind : null;
    if (!kind) throw new AppError("VALIDATION", "نوع ارجاع (همکار یا واحد) مشخص نشده است");

    const result = referCase({
      caseId: caseRow.id,
      actor: actorOf(session),
      kind,
      toStaffId: asString(body.toStaffId, 120),
      toUnit: asString(body.toUnit, 120),
      reason: asString(body.reason, 2000),
      description: asString(body.description, 4000),
      expectedOutput: asString(body.expectedOutput, 2000),
      priority: asString(body.priority, 20),
      dueAt: asString(body.dueAt, 40),
      note: asString(body.note, 2000),
      idempotencyKey: idempotencyKey(request),
    });

    return ok(result, { status: result.replayed ? 200 : 201 });
  } catch (err) {
    return fail(err);
  }
}
