import { NextResponse, type NextRequest } from "next/server";
import { pullOnce, type IngestEntity } from "@/services/sync";
import * as Platform from "@/db/repos/platform";
import { ensureMigrated } from "@/db/migrate";
import { safeEqual } from "@/auth/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENTITIES: IngestEntity[] = ["users", "contracts", "listings", "requirements"];

function authorized(request: NextRequest): boolean {
  const expected = process.env.SYNC_API_KEY ?? "";
  if (!expected) return false;
  return safeEqual(request.headers.get("x-sync-key") ?? "", expected);
}

/** زمان‌بند: واکشی اختلاف‌ها از سرور اصلی (کانال Pull) */
export async function POST(request: NextRequest) {
  ensureMigrated();
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, message: "کلید سینک نامعتبر است" }, { status: 401 });
  }
  const entity = new URL(request.url).searchParams.get("entity");
  const targets = entity && ENTITIES.includes(entity as IngestEntity) ? [entity as IngestEntity] : ENTITIES;
  const outcomes = [];
  for (const target of targets) {
    outcomes.push(await pullOnce(target));
  }
  Platform.writeAudit({
    actorType: "system",
    actorId: null,
    actorName: "cron",
    action: "sync.pull",
    entityType: "sync",
    entityId: targets.join(","),
    detail: { results: outcomes.map((o) => ({ entity: o.entity, ok: o.ok, message: o.message })) },
  });
  return NextResponse.json({
    ok: outcomes.every((o) => o.ok),
    results: outcomes,
  });
}

export async function GET() {
  const cursors = {
    users: Platform.getPullCursor("users"),
    contracts: Platform.getPullCursor("contracts"),
    listings: Platform.getPullCursor("listings"),
    requirements: Platform.getPullCursor("requirements"),
  };
  return NextResponse.json({ ok: true, pullUrl: process.env.SYNC_PULL_URL ?? "", cursors });
}
