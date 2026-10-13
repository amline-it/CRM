import { NextResponse, type NextRequest } from "next/server";
import { checkIngestAuth, ingest, parseBody, type IngestEntity } from "@/services/sync";
import * as Platform from "@/db/repos/platform";
import { ensureMigrated } from "@/db/migrate";
import { AppError, toErrorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENTITIES: IngestEntity[] = ["users", "contracts", "listings", "requirements"];

function isEntity(value: string): value is IngestEntity {
  return ENTITIES.includes(value as IngestEntity);
}

/**
 * دریافت داده از سرور اصلی (Push).
 * هدرها: X-Sync-Key، X-Signature: sha256=HMAC(secret, rawBody)، X-Idempotency-Key (اختیاری)، X-Sync-Source (اختیاری)
 */
export async function POST(request: NextRequest, context: { params: Promise<{ entity: string }> }) {
  try {
    ensureMigrated();
    const { entity } = await context.params;
    if (!isEntity(entity)) {
      return NextResponse.json(
        { ok: false, code: "SYNC_INVALID", message: `موجودیت نامعتبر است؛ مقادیر مجاز: ${ENTITIES.join(", ")}` },
        { status: 404 },
      );
    }

    const rawBody = await request.text();
    const apiKey = request.headers.get("x-sync-key");
    const signature = request.headers.get("x-signature");
    const idempotencyKey = request.headers.get("x-idempotency-key");
    const source = request.headers.get("x-sync-source");

    const auth = checkIngestAuth({ apiKey, signature, idempotencyKey, source }, rawBody);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, code: "SYNC_AUTH", message: auth.message }, { status: auth.status });
    }

    if (idempotencyKey) {
      const replay = Platform.getIdempotentResponse(idempotencyKey);
      if (replay) {
        return NextResponse.json(
          { ok: true, replayed: true, ...(replay.response ? (JSON.parse(replay.response) as Record<string, unknown>) : {}) },
          { status: replay.status },
        );
      }
    }

    const body = parseBody(rawBody);
    const result = ingest(entity, body, { apiKey, signature, idempotencyKey, source });

    if (idempotencyKey) {
      Platform.saveIdempotentResponse(idempotencyKey, `ingest:${entity}`, 200, result);
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    const message = err instanceof AppError ? err.message : String(body.message ?? "خطای اینگست");
    return NextResponse.json({ ok: false, code: body.code, message }, { status });
  }
}

/** بررسی سلامت endpoint سینک بدون افشای داده */
export async function GET(_request: NextRequest, context: { params: Promise<{ entity: string }> }) {
  const { entity } = await context.params;
  if (!isEntity(entity)) {
    return NextResponse.json({ ok: false, message: "موجودیت نامعتبر است" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    entity,
    configured: Boolean(process.env.SYNC_API_KEY),
    requires: ["X-Sync-Key", "X-Signature: sha256=HMAC(SYNC_SECRET, rawBody)"],
    method: "POST",
  });
}
