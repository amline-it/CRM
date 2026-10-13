import { NextResponse } from "next/server";
import { ensureMigrated } from "@/db/migrate";
import * as Cases from "@/db/repos/cases";
import * as People from "@/db/repos/people";
import * as Catalog from "@/db/repos/catalog";
import { validateAllDefinitions } from "@/domain/workflows";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** بررسی سلامت سامانه — برای مانیتورینگ سرور کاربر */
export async function GET() {
  const started = Date.now();
  try {
    ensureMigrated();
    const definitions = validateAllDefinitions();
    const errors = Object.entries(definitions).flatMap(([key, issues]) =>
      issues.filter((issue) => issue.level === "error").map((issue) => `${key}: ${issue.message}`),
    );
    return NextResponse.json({
      ok: errors.length === 0,
      app: "crm-realestate",
      time: new Date().toISOString(),
      db: {
        cases: Cases.listCases({ limit: 1000 }).length,
        users: People.countUsers(),
        listings: Catalog.listListings({ limit: 1000 }).length,
        requirements: Catalog.listRequirements({ limit: 1000 }).length,
      },
      definitions: {
        valid: errors.length === 0,
        errors,
        workflows: Object.fromEntries(Object.entries(definitions).map(([key, issues]) => [key, issues.length])),
      },
      integrations: {
        syncConfigured: Boolean(process.env.SYNC_API_KEY),
        webhookConfigured: Boolean(process.env.WEBHOOK_TARGET_URL),
        paymentProvider: process.env.PAYMENT_PROVIDER ?? "sandbox",
        trackingProvider: process.env.TRACKING_PROVIDER ?? "manual",
        notificationProvider: process.env.NOTIFICATION_PROVIDER ?? "log",
        ssoEnabled: process.env.SSO_ENABLED === "true",
      },
      latencyMs: Date.now() - started,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "خطای ناشناخته" },
      { status: 500 },
    );
  }
}
