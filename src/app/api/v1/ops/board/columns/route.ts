import { type NextRequest } from "next/server";
import { assertMutation, fail, ok, readJson, requireApiSession } from "@/services/ops-api";
import { can } from "@/auth/rbac";
import { AppError } from "@/lib/errors";
import * as Platform from "@/db/repos/platform";
import * as Columns from "@/domain/service/board-columns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** چیدمان مؤثر ستون‌ها برای یک کارمند (کلیدها به ترتیب، همراه نام واحدها) */
function snapshot(staffId: string, canSetDefaultOrder: boolean) {
  const layout = Columns.columnLayout(staffId);
  return {
    order: layout.order,
    source: layout.source,
    personalOrder: layout.personalOrder,
    canSetDefaultOrder,
    units: layout.units.map((unit) => ({ key: unit.key, name: unit.name, description: unit.description })),
  };
}

/**
 * GET /api/v1/ops/board/columns — چیدمان فعلی ستون‌های کانبان برای کارمند جاری.
 * مجوز: `case.view` (هر کارمند چیدمان خودش را می‌بیند؛ ترتیب شخصی روی دیگران اثر ندارد).
 */
export async function GET() {
  try {
    const session = await requireApiSession("case.view");
    return ok(snapshot(session.staff.id, can(session.role, "referral.manage")));
  } catch (err) {
    return fail(err);
  }
}

/**
 * PUT /api/v1/ops/board/columns — ذخیره ترتیب ستون‌ها.
 *
 * بدنه:
 *   { order: string[], scope?: "personal" | "default" }   ذخیره ترتیب
 *   { reset: true,  scope?: "personal" | "default" }      بازگشت به ترتیب پیش‌فرض
 *
 * `scope: "personal"` (پیش‌فرض) چیدمان همین کارمند را ذخیره می‌کند؛
 * `scope: "default"` ترتیب پیش‌فرض همه کارکنان را روی `org_units.sort_order`
 * می‌نویسد و فقط برای مدیر مجاز است. هدر `X-CSRF-Token` الزامی است.
 */
export async function PUT(request: NextRequest) {
  try {
    await assertMutation(request);
    const session = await requireApiSession("case.view");
    const body = await readJson(request);
    const scope = body.scope === "default" ? "default" : "personal";
    if (scope === "default" && !can(session.role, "referral.manage")) {
      throw new AppError("FORBIDDEN", "تغییر ترتیب پیش‌فرض ستون‌ها فقط برای مدیر مجاز است");
    }

    if (body.reset === true) {
      if (scope === "default") {
        const applied = Columns.resetDefaultColumnOrder();
        Platform.writeAudit({
          actorType: session.role,
          actorId: session.staff.id,
          actorName: session.staff.full_name,
          action: "ops.board.columns.resetDefault",
          entityType: "board",
          entityId: "kanban",
          detail: { order: applied },
        });
      } else {
        Columns.clearPersonalColumnOrder(session.staff.id);
      }
    } else {
      const order = Columns.parseColumnOrder(body.order);
      if (scope === "default") {
        Columns.applyTeamColumnOrder(order, session.staff.id);
        // چیدمان مشترک، تنظیمات تیمی است → در گزارش رویدادها ثبت می‌شود
        Platform.writeAudit({
          actorType: session.role,
          actorId: session.staff.id,
          actorName: session.staff.full_name,
          action: "ops.board.columns.setDefault",
          entityType: "board",
          entityId: "kanban",
          detail: { order },
        });
      } else {
        Columns.savePersonalColumnOrder(session.staff.id, order);
      }
    }

    return ok(snapshot(session.staff.id, can(session.role, "referral.manage")));
  } catch (err) {
    return fail(err);
  }
}
