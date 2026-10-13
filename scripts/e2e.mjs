#!/usr/bin/env node
/**
 * آزمون سرتاسری (E2E) روی سرور در حال اجرا.
 * پیش‌نیاز: npm run dev  (یا start) و اجرای migrate/seed
 * استفاده: npm run e2e  [-- --base http://localhost:3000]
 *
 * پوشش:
 *  ۱) سلامت سامانه و اعتبارسنجی کلید/امضای سینک
 *  ۲) اینگست کاربران، قرارداد، آگهی، نیازمندی (شامل تکرار idempotency و آیتم خراب)
 *  ۳) پخش وب‌هوک خروجی با امضای HMAC به یک گیرنده واقعی
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const projectRoot = process.cwd();
const baseArgIndex = process.argv.indexOf("--base");
const BASE = (baseArgIndex !== -1 ? process.argv[baseArgIndex + 1] : process.env.E2E_BASE_URL) ?? "http://localhost:3000";

/* ── خواندن .env.local / .env برای کلیدها ─────────────────────────── */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
loadEnvFile(path.join(projectRoot, ".env.local"));
loadEnvFile(path.join(projectRoot, ".env"));

const API_KEY = process.env.SYNC_API_KEY ?? "";
const SECRET = process.env.SYNC_SECRET ?? "";
const dbPath = path.isAbsolute(process.env.DATABASE_PATH ?? "")
  ? process.env.DATABASE_PATH
  : path.join(projectRoot, process.env.DATABASE_PATH ?? "data/crm.db");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, extra = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${extra ? ` — ${extra}` : ""}`);
    console.log(`  ✘ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function sign(rawBody) {
  return `sha256=${crypto.createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex")}`;
}

async function postJson(pathname, body, { key = API_KEY, signature = true, idempotencyKey, source = "e2e" } = {}) {
  const raw = JSON.stringify(body);
  const headers = { "Content-Type": "application/json", "X-Sync-Source": source };
  if (key !== null) headers["X-Sync-Key"] = key;
  if (signature) headers["X-Signature"] = sign(raw);
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`${BASE}${pathname}`, { method: "POST", headers, body: raw });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* پاسخ غیر JSON */
  }
  return { status: response.status, json, text };
}

async function main() {
  console.log(`\n═══ آزمون سرتاسری CRM — ${BASE} ═══\n`);

  /* ── ۱) سلامت ────────────────────────────────────────────────────── */
  console.log("۱) سلامت سامانه و امنیت سینک");
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check("سامانه پاسخ سلامت می‌دهد", health.ok === true, JSON.stringify(health).slice(0, 160));
  check("همه تعریف‌های گردش‌کار معتبرند", health.definitions?.valid === true, (health.definitions?.errors ?? []).join("، "));

  const noKey = await postJson("/api/v1/ingest/users", { items: [] }, { key: null });
  check("درخواست بدون کلید سینک رد می‌شود (۴۰۱)", noKey.status === 401, `status=${noKey.status}`);

  const badKey = await postJson("/api/v1/ingest/users", { items: [] }, { key: "wrong-key" });
  check("کلید نادرست رد می‌شود (۴۰۱)", badKey.status === 401, `status=${badKey.status}`);

  const badSignature = await postJson("/api/v1/ingest/users", { items: [] }, { signature: false });
  check("امضای نادرست رد می‌شود (۴۰۱)", badSignature.status === 401, `status=${badSignature.status}`);

  const unknownEntity = await postJson("/api/v1/ingest/unknown", { items: [] });
  check("موجودیت ناشناخته ۴۰۴ می‌دهد", unknownEntity.status === 404, `status=${unknownEntity.status}`);

  /* ── ۲) اینگست ───────────────────────────────────────────────────── */
  console.log("\n۲) اینگست داده از سرور اصلی");
  const stamp = Date.now();

  const usersBatch = {
    source: "main-server",
    items: [
      { externalId: `e2e-user-${stamp}-1`, fullName: "کاربر آزمون یک", mobile: "09120000001", city: "تهران", userType: "normal" },
      { externalId: `e2e-user-${stamp}-2`, fullName: "مشاور آزمون", mobile: "09120000002", city: "تهران", userType: "agent", agentLicenseNo: "E2E-1" },
    ],
  };
  const usersResult = await postJson("/api/v1/ingest/users", usersBatch, { idempotencyKey: `e2e-users-${stamp}` });
  check("کاربران ثبت شدند (۲ مورد)", usersResult.status === 200 && usersResult.json?.summary?.created === 2, JSON.stringify(usersResult.json?.summary));

  const replay = await postJson("/api/v1/ingest/users", usersBatch, { idempotencyKey: `e2e-users-${stamp}` });
  check("تکرار همان درخواست با Idempotency-Key بازپخش می‌شود", replay.json?.replayed === true, JSON.stringify(replay.json).slice(0, 120));

  const sameAgain = await postJson("/api/v1/ingest/users", usersBatch);
  check(
    "ارسال دوباره بدون تغییر → unchanged",
    sameAgain.json?.summary?.unchanged === 2,
    JSON.stringify(sameAgain.json?.summary),
  );

  const contractResult = await postJson("/api/v1/ingest/contracts", {
    source: "main-server",
    items: [
      {
        externalId: `e2e-contract-${stamp}`,
        title: "قرارداد اجاره آزمون",
        contractType: "rent",
        outputMode: "signature_and_tracking",
        city: "تهران",
        district: "ونک",
        area: 85,
        landlordName: "مالک آزمون",
        tenantName: "مستأجر آزمون",
        depositAmount: 150000000,
        rentAmount: 18000000,
        ownerExternalId: `e2e-user-${stamp}-1`,
        trackingCode: "140512345678901",
        documents: [{ kind: "national_landlord", title: "کارت ملی مالک", status: "submitted" }],
      },
      { title: "قرارداد بدون شناسه بیرونی" }, // آیتم خراب: externalId ندارد
    ],
  });
  const contractSummary = contractResult.json?.summary ?? {};
  check(
    "قرارداد سالم ثبت و آیتم خراب رد شد (partial)",
    contractResult.status === 200 && contractSummary.created === 1 && contractSummary.rejected === 1,
    JSON.stringify(contractSummary),
  );
  check(
    "جزئیات آیتم رد‌شده برگردانده می‌شود",
    Array.isArray(contractResult.json?.items) && contractResult.json.items.some((item) => item.action === "rejected" && item.reason),
  );

  const listingResult = await postJson("/api/v1/ingest/listings", {
    source: "main-server",
    items: [
      {
        externalId: `e2e-listing-${stamp}`,
        dealType: "rent",
        propertyType: "آپارتمان",
        city: "تهران",
        district: "ونک",
        area: 85,
        rooms: 2,
        deposit: 150000000,
        rent: 18000000,
        ownerExternalId: `e2e-user-${stamp}-1`,
        agentExternalId: `e2e-user-${stamp}-2`,
        images: ["https://example.com/1.jpg"],
      },
    ],
  });
  check("آگهی ثبت شد", listingResult.json?.summary?.created === 1, JSON.stringify(listingResult.json?.summary));

  const requirementResult = await postJson("/api/v1/ingest/requirements", {
    source: "main-server",
    items: [
      {
        externalId: `e2e-requirement-${stamp}`,
        dealType: "rent",
        propertyType: "آپارتمان",
        city: "تهران",
        districts: ["ونک", "جردن"],
        budgetMin: 100000000,
        budgetMax: 200000000,
        areaMin: 70,
        areaMax: 100,
        rooms: 2,
        requesterExternalId: `e2e-user-${stamp}-1`,
        accessLevel: "public",
      },
    ],
  });
  check("نیازمندی ثبت شد", requirementResult.json?.summary?.created === 1, JSON.stringify(requirementResult.json?.summary));

  const afterIngest = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check(
    "داده‌های سینک‌شده در شمارش سامانه دیده می‌شوند",
    afterIngest.db.users.total >= 8 && afterIngest.db.listings >= 4 && afterIngest.db.requirements >= 3,
    JSON.stringify(afterIngest.db),
  );

  /* ── ۳) وب‌هوک خروجی ────────────────────────────────────────────── */
  console.log("\n۳) وب‌هوک خروجی و امضای HMAC");
  const received = [];
  const receiver = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({ headers: request.headers, body });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{\"ok\":true}");
    });
  });
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const receiverPort = receiver.address().port;
  const receiverUrl = `http://127.0.0.1:${receiverPort}/hook`;

  const db = new DatabaseSync(dbPath);
  const webhookId = `wh_e2e_${crypto.randomBytes(6).toString("hex")}`;
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('sync.webhookUrl', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(receiverUrl), nowIso);
  db.prepare(
    `INSERT INTO outbound_webhooks (id, event, case_id, payload, target_url, status, attempts, next_attempt_at, created_at, updated_at)
     VALUES (?, 'case.completed', NULL, ?, ?, 'pending', 0, ?, ?, ?)`,
  ).run(webhookId, JSON.stringify({ caseId: "case-e2e", code: "CRM-E2E", outcome: "completed" }), receiverUrl, nowIso, nowIso, nowIso);
  db.close();

  const dispatch = await fetch(`${BASE}/api/v1/jobs/dispatch-webhooks`, {
    method: "POST",
    headers: { "X-Sync-Key": API_KEY },
  }).then((r) => r.json());
  check("پخش وب‌هوک انجام شد", dispatch.ok === true && dispatch.processed >= 1, JSON.stringify(dispatch).slice(0, 160));
  check("گیرنده وب‌هوک را دریافت کرد", received.length >= 1, `received=${received.length}`);

  if (received.length) {
    const event = received.find((item) => item.headers["x-webhook-event"] === "case.completed");
    check("رویداد درست ارسال شد", Boolean(event), JSON.stringify(received[0]?.headers ?? {}));
    if (event) {
      const expected = `sha256=${crypto.createHmac("sha256", process.env.WEBHOOK_SECRET || SECRET).update(event.body, "utf8").digest("hex")}`;
      check("امضای وب‌هوک معتبر است", event.headers["x-webhook-signature"] === expected, String(event.headers["x-webhook-signature"]));
      const payload = JSON.parse(event.body);
      check("بدنه وب‌هوک شامل رویداد و داده است", payload.event === "case.completed" && payload.data?.outcome === "completed");
    }
  }

  const verify = new DatabaseSync(dbPath);
  const row = verify.prepare("SELECT status, delivered_at FROM outbound_webhooks WHERE id = ?").get(webhookId);
  verify.close();
  check("وضعیت وب‌هوک در دیتابیس «تحویل‌شده» است", row?.status === "delivered" && Boolean(row?.delivered_at), JSON.stringify(row));

  await new Promise((resolve) => receiver.close(resolve));

  /* ── جمع‌بندی ───────────────────────────────────────────────────── */
  console.log(`\n═══ نتیجه: ${passed} موفق، ${failed} ناموفق ═══`);
  if (failed) {
    console.log("موارد ناموفق:");
    for (const item of failures) console.log(`  - ${item}`);
    process.exit(1);
  }
  console.log("همه سنجه‌های سرتاسری با موفقیت گذشت.\n");
}

main().catch((err) => {
  console.error("\n[E2E] خطای اجرا:", err.message);
  console.error("مطمئن شوید سرور در حال اجراست (npm run dev) و migrate/seed انجام شده است.");
  process.exit(1);
});
