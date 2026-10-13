import { type NextRequest } from "next/server";
import { fail, ok, requireApiSession } from "@/services/ops-api";
import { buildBoard, type BoardFilterInput } from "@/domain/service/referral-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function pickDue(value: string | null): BoardFilterInput["due"] {
  if (value === "overdue" || value === "today" || value === "week" || value === "none") return value;
  return undefined;
}

/**
 * GET /api/v1/ops/board — داده تخته کانبان عملیات با فیلترهای سمت سرور.
 * فیلترها: service, unit, staff, status, priority, due, q, mine, unassigned, closed
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession("case.view");
    const params = new URL(request.url).searchParams;
    const board = buildBoard(
      { id: session.staff.id, role: session.role, unit: session.staff.org_unit ?? null, name: session.staff.full_name },
      {
        serviceKey: params.get("service") ?? undefined,
        unitKey: params.get("unit") ?? undefined,
        staffId: params.get("staff") ?? undefined,
        kanbanStatus: params.get("status") ?? undefined,
        priority: params.get("priority") ?? undefined,
        due: pickDue(params.get("due")),
        search: params.get("q") ?? undefined,
        mine: params.get("mine") === "1",
        unassigned: params.get("unassigned") === "1",
        includeClosed: params.get("closed") === "1",
      },
    );
    return ok(board);
  } catch (err) {
    return fail(err);
  }
}
