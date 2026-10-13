import { fail, ok, requireApiSession } from "@/services/ops-api";
import { mentionDirectory } from "@/domain/service/conversation-service";
import * as Referrals from "@/db/repos/referrals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/ops/staff — فهرست کارمندان فعال و واحدهای سازمانی
 * برای انتخاب مقصد ارجاع و منشن همکار. مجوز: `referral.create`.
 */
export async function GET() {
  try {
    await requireApiSession("referral.create");
    const units = Referrals.listOrgUnits().map((u) => ({
      key: u.key,
      name: u.name,
      description: u.description,
      staff: mentionDirectory().filter((s) => s.unitKey === u.key).map((s) => ({ id: s.id, fullName: s.fullName, title: s.title })),
    }));
    return ok({ units, staff: mentionDirectory() });
  } catch (err) {
    return fail(err);
  }
}
