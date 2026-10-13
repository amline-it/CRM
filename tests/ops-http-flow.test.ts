/**
 * آزمون سرتاسری HTTP روی سرور در حال اجرا — همان معیار پذیرش کارفرما:
 * «کارمند از روی یک پرونده واقعی ارجاع می‌سازد → همکار مقصد اعلان می‌گیرد →
 *  کارت درست در کانبان ظاهر می‌شود → پیام‌ها و تاریخچه قابل مشاهده‌اند.»
 *
 * این آزمون به‌جای فراخوانی توابع سرویس، مسیر واقعی مرورگر را طی می‌کند:
 *   ورود با نام کاربری/رمز → نشست واقعی → /api/v1/ops/* با CSRF و Idempotency-Key
 *
 * اجرا:
 *   OPS_FLOW_BASE=http://127.0.0.1:3000 npx vitest run tests/ops-http-flow.test.ts
 * بدون تنظیم متغیر، آزمون رد می‌شود (CI بدون سرور هم سبز می‌ماند).
 *
 * پیش‌نیاز: سرور با «ورود واقعی» (LOCAL_DEMO_MODE=false)، دیتابیس نمونه با
 * `npm run seed -- --demo --staff admin:Admin@1234:مدیر` و کارشناسان نمونه با رمز Demo@1234.
 */
import fs from "node:fs";
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.OPS_FLOW_BASE ?? "";
const describeIfServer = BASE ? describe : describe.skip;

const ADMIN = { username: process.env.OPS_FLOW_ADMIN ?? "admin", password: process.env.OPS_FLOW_ADMIN_PASSWORD ?? "Admin@1234" };
const STAFF_PASSWORD = process.env.OPS_FLOW_STAFF_PASSWORD ?? "Demo@1234";

/** رمز امضای CSRF از محیط یا .env.local (همان مقداری که سرور می‌خواند) */
function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(process.cwd(), ".env.local");
  const line = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split("\n").find((row) => row.startsWith("SESSION_SECRET="))
    : undefined;
  const value = line?.slice("SESSION_SECRET=".length).trim();
  if (!value) throw new Error("SESSION_SECRET برای اجرای آزمون HTTP لازم است (.env.local)");
  return value;
}

/** توکن CSRF امضاشده — همان الگوریتم src/auth/csrf.ts */
function csrfToken(): string {
  const nonce = randomBytes(16).toString("base64url");
  const issuedAt = String(Date.now());
  const payload = `${nonce}.${issuedAt}`;
  const signature = createHmac("sha256", sessionSecret()).update(payload, "utf8").digest("base64url");
  return `${payload}.${signature}`;
}

interface ApiResult<T = Record<string, unknown>> {
  status: number;
  ok: boolean;
  data: T;
  raw: Record<string, unknown>;
}

const TICKET_PATTERN = /eyJhbGciOiJIUzI1NiJ9[A-Za-z0-9_.-]+/;

function hiddenFields(html: string): Record<string, string> {
  const form = html.match(/<form[^>]*>[\s\S]*?<\/form>/)?.[0] ?? html;
  const fields: Record<string, string> = {};
  const pattern = /<input[^>]*name="([^"]+)"[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(form))) {
    const name = match[1];
    if (!name.startsWith("$ACTION") && name !== "_csrf") continue;
    const value = match[0].match(/value="([^"]*)"/)?.[1] ?? "";
    fields[name] = value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }
  return fields;
}

/** ورود واقعی از فرم و دریافت توکن نشست (همان کاری که مرورگر می‌کند) */
async function login(username: string, password: string): Promise<string> {
  const page = await fetch(`${BASE}/login`).then((response) => response.text());
  const form = new FormData();
  for (const [key, value] of Object.entries(hiddenFields(page))) form.set(key, value);
  form.set("username", username);
  form.set("password", password);
  form.set("sso_token", "");
  const response = await fetch(`${BASE}/login`, { method: "POST", body: form, redirect: "manual" });
  const ticket = (await response.text()).match(TICKET_PATTERN)?.[0] ?? "";
  if (!ticket) {
    throw new Error(
      `ورود ${username} ناموفق بود (status ${response.status}). این آزمون به سروری با ورود واقعی نیاز دارد: ` +
        `LOCAL_DEMO_MODE=false npm run dev — در حالت نمایش محلی (LOCAL_DEMO_MODE=true) صفحه ورود غیرفعال است.`,
    );
  }
  return ticket;
}

function client(ticket: string | null) {
  const headers = (extra: Record<string, string> = {}) => ({
    accept: "application/json",
    ...(ticket ? { "x-session-ticket": ticket } : {}),
    ...extra,
  });

  async function call<T>(method: string, url: string, body?: unknown, extra: Record<string, string> = {}): Promise<ApiResult<T>> {
    const mutation = method !== "GET";
    const response = await fetch(`${BASE}${url}`, {
      method,
      headers: headers({
        ...(mutation ? { "x-csrf-token": csrfToken(), "content-type": "application/json" } : {}),
        ...extra,
      }),
      body: mutation ? JSON.stringify(body ?? {}) : undefined,
      redirect: "manual",
    });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { raw: text.slice(0, 400) };
    }
    return {
      status: response.status,
      ok: parsed.ok === true,
      data: (parsed.data ?? {}) as T,
      raw: parsed,
    };
  }

  return { call, get: <T>(url: string) => call<T>("GET", url) };
}

type BoardCard = {
  caseId: string;
  code: string | null;
  title: string | null;
  currentUnit: string | null;
  currentUnitName: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  kanbanStatus: string;
  hasOwner: boolean;
  canAct: boolean;
  allowedActions: string[];
  referralPath: Array<{ kind: string; reason: string | null; toUnit: string; at: string; toName: string | null }>;
  unreadMessages: number;
  caseStatus?: string;
  lastMessage: { body: string } | null;
  priority: string;
  caseUrl: string;
};

type Board = {
  columns: Array<{ unitKey: string; unitName: string; cards: BoardCard[] }>;
  units: Array<{ key: string; name: string }>;
  stats: { total: number; unassigned: number; overdue: number; unreadMessages: number };
  columnOrder: string[];
  columnOrderSource: "personal" | "default";
  canSetDefaultOrder: boolean;
};

let adminTicket = "";
let legalTicket = "";
let techTicket = "";
let salesTicket = "";
let techId = "";

const cards = (board: Board) => board.columns.flatMap((column) => column.cards);

beforeAll(async () => {
  adminTicket = await login(ADMIN.username, ADMIN.password);
  legalTicket = await login("legal1", STAFF_PASSWORD);
  techTicket = await login("tech1", STAFF_PASSWORD);
  salesTicket = await login("sales1", STAFF_PASSWORD);
  const directory = await client(techTicket).get<{ staff: Array<{ id: string; fullName: string }> }>("/api/v1/ops/staff");
  techId = directory.data.staff.find((s) => s.fullName.includes("فنی"))?.id ?? "";
  expect(techId).not.toBe("");
});

describeIfServer("پذیرش سرتاسری عملیات روی سرور واقعی", () => {
  it("دسترسی‌ها: بدون نشست ۴۰۱، با نشست کارمند تخته و صندوق اعلان پاسخ می‌دهند", async () => {
    const anonymousBoard = await client(null).get("/api/v1/ops/board");
    expect(anonymousBoard.status).toBe(401);
    const anonymousInbox = await client(null).get("/api/v1/ops/notifications");
    expect(anonymousInbox.status).toBe(401);

    const board = await client(adminTicket).get<Board>("/api/v1/ops/board");
    expect(board.status).toBe(200);
    expect(board.data.columns.length).toBeGreaterThan(0);
    expect(board.data.units.some((u) => u.key === "legal")).toBe(true);
  });

  it("سناریوی پذیرش: ارجاع واقعی، اعلان همکار مقصد، ظاهر شدن کارت در ستون درست، پیام و تاریخچه", async () => {
    // ۰) آماده‌سازی وضعیت آغازین (تکرارپذیری آزمون): مدیر یک کارت واقعی را به صف واحد حقوقی برمی‌گرداند
    const admin = client(adminTicket);
    const adminBoard = await admin.get<Board>("/api/v1/ops/board?closed=1");
    expect(adminBoard.status).toBe(200);
    const candidate = cards(adminBoard.data).find((card) => card.canAct && card.assignedStaffId) ?? cards(adminBoard.data)[0];
    expect(candidate).toBeTruthy();
    const reset = await admin.call<{ kanbanStatus: string }>("POST", `/api/v1/ops/cases/${candidate.caseId}/actions`, {
      action: "rerefer",
      kind: "unit",
      toUnit: "legal",
      reason: "بازنشانی وضعیت آغازین برای آزمون پذیرش",
    });
    expect([200, 201]).toContain(reset.status);

    // ۱) کارمند حقوقی، کارت واقعی صف واحد خود را برمی‌دارد
    const legalClient = client(legalTicket);
    const boardBefore = await legalClient.get<Board>("/api/v1/ops/board");
    expect(boardBefore.status).toBe(200);
    const inQueue = cards(boardBefore.data).filter((card) => card.caseId === candidate.caseId);
    expect(inQueue).toHaveLength(1);
    const target = inQueue[0];
    expect(target.currentUnit).toBe("legal");
    expect(target.canAct).toBe(true);
    const pathLengthBefore = target.referralPath.length;

    // ۲) ارجاع به واحد فنی (صف واحد) با شرح کار، اولویت و مهلت
    const idempotency = `e2e-${Date.now()}`;
    const refer = await legalClient.call<{ referralId: string; toUnit: string; toUnitName: string; toStaffId: string | null; replayed: boolean }>(
      "POST",
      `/api/v1/ops/cases/${target.caseId}/refer`,
      {
        kind: "unit",
        toUnit: "technical",
        reason: "بررسی فنی و تأیید نهایی",
        description: "بازبینی نقشه و تأیید فنی مساحت",
        expectedOutput: "گزارش تأیید فنی",
        priority: "high",
        dueAt: "۱۴۰۵/۰۸/۰۱",
      },
      { "idempotency-key": idempotency },
    );
    expect(refer.status).toBe(201);
    expect(refer.data.toUnit).toBe("technical");
    expect(refer.data.toStaffId).toBeNull(); // صف واحد، بدون مسئول مشخص

    // ۳) retry همان درخواست (مثل شبکه ناپایدار) → ارجاع تکراری ساخته نمی‌شود
    const retry = await legalClient.call<{ referralId: string; replayed: boolean }>(
      "POST",
      `/api/v1/ops/cases/${target.caseId}/refer`,
      { kind: "unit", toUnit: "technical", reason: "بررسی فنی و تأیید نهایی" },
      { "idempotency-key": idempotency },
    );
    expect(retry.status).toBe(200);
    expect(retry.data.replayed).toBe(true);
    expect(retry.data.referralId).toBe(refer.data.referralId);

    // ۴) همکار فنی اعلان «صف واحد» می‌گیرد و به پرونده لینک داده می‌شود
    const techClient = client(techTicket);
    const inbox = await techClient.get<{ items: Array<{ id: string; kind: string; case_id: string; link: string; body: string; read_at: string | null }> }>(
      "/api/v1/ops/notifications?filter=unread",
    );
    expect(inbox.status).toBe(200);
    const notice = inbox.data.items.find((row) => row.case_id === target.caseId && row.kind.startsWith("referral"));
    expect(notice).toBeTruthy();
    expect(notice!.link).toBe(`/panel/cases/${target.caseId}#ops-quick-actions`);
    expect(notice!.read_at).toBeNull();

    // ۵) کارت در ستون «واحد فنی» و بدون مسئول است، و از ستون حقوقی رفته
    const boardAfter = await techClient.get<Board>("/api/v1/ops/board");
    const moved = cards(boardAfter.data).find((card) => card.caseId === target.caseId)!;
    expect(moved.currentUnit).toBe("technical");
    expect(moved.currentUnitName).toBe("واحد فنی");
    expect(moved.hasOwner).toBe(false);
    expect(moved.assignedStaffId).toBeNull(); // به فرد قبلی نسبت داده نمی‌شود
    expect(moved.priority).toBe("high");
    expect(moved.kanbanStatus).toBe("new");
    expect(cards(boardAfter.data).filter((card) => card.caseId === target.caseId)).toHaveLength(1);
    expect(boardAfter.data.columns.find((c) => c.unitKey === "legal")!.cards.some((c) => c.caseId === target.caseId)).toBe(false);
    expect(moved.canAct).toBe(true); // کارمند همان واحد جاری

    // ۶) گفت‌وگوی داخلی: پیام + منشن به کارمند حقوقی
    const legalId = candidate.assignedStaffId;
    const message = await techClient.call<{ message: { id: string; body: string }; mentioned: string[]; notified: number }>(
      "POST",
      `/api/v1/ops/cases/${target.caseId}/messages`,
      { body: "@کارشناس حقوقی نقشه‌ها را فرستادم، بررسی می‌کنم", mentionStaffIds: legalId ? [legalId] : [] },
    );
    expect(message.status).toBe(201);
    expect(message.data.message.body).toContain("بررسی می‌کنم");

    const threadForTech = await techClient.get<{ messages: Array<{ body: string; authorName: string }>; unread: number }>(
      `/api/v1/ops/cases/${target.caseId}/messages?markRead=0`,
    );
    expect(threadForTech.data.messages.some((m) => m.body.includes("بررسی می‌کنم"))).toBe(true);

    // پیام برای کارمند حقوقی (مشارکت‌کننده زنجیره) هم دیده می‌شود و اعلان دارد
    const legalInbox = await client(legalTicket).get<{ items: Array<{ kind: string; case_id: string }> }>(
      "/api/v1/ops/notifications?filter=unread",
    );
    expect(legalInbox.data.items.some((row) => row.case_id === target.caseId && (row.kind === "mention" || row.kind === "message.new"))).toBe(true);

    const threadForLegal = await client(legalTicket).get<{ messages: Array<{ body: string }> }>(
      `/api/v1/ops/cases/${target.caseId}/messages`,
    );
    expect(threadForLegal.data.messages.some((m) => m.body.includes("بررسی می‌کنم"))).toBe(true);

    // ۷) تاریخچه: ارجاع قبلی دست‌نخورده و ارجاع تازه در انتهای مسیر
    const opsView = await techClient.get<{
      ops: { referralPath: Array<{ reason: string | null; toUnit: string }>; kanbanStatus: string; allowedActions: string[]; assignedStaffName: string | null };
      conversation: { messages: Array<{ body: string }> };
    }>(`/api/v1/ops/cases/${target.caseId}?markRead=0`);
    expect(opsView.status).toBe(200);
    const path = opsView.data.ops.referralPath;
    expect(path[path.length - 1].toUnit).toBe("technical");
    expect(path[path.length - 1].reason).toBe("بررسی فنی و تأیید نهایی");
    expect(path.length).toBe(pathLengthBefore + 1);
    expect(opsView.data.ops.allowedActions).toContain("start_review");

    // ۸) اقدام مسئول صف: شروع بررسی → در حال بررسی (اعلان به ارجاع‌دهنده)
    const started = await techClient.call<{ kanbanStatus: string; statusBefore: string }>(
      "POST",
      `/api/v1/ops/cases/${target.caseId}/actions`,
      { action: "start_review" },
    );
    expect(started.status).toBe(201);
    expect(started.data.statusBefore).toBe("new");
    expect(started.data.kanbanStatus).toBe("in_review");

    // ۹) اتمام عملیات کانبان نباید وضعیت خود قرارداد/پرونده را تغییر دهد
    const completed = await techClient.call<{ kanbanStatus: string }>(
      "POST",
      `/api/v1/ops/cases/${target.caseId}/actions`,
      { action: "complete", resultNote: "تأیید فنی صادر شد" },
    );
    expect(completed.status).toBe(201);
    expect(completed.data.kanbanStatus).toBe("done");

    const afterComplete = await client(adminTicket).get<Board>("/api/v1/ops/board?closed=1");
    const finished = cards(afterComplete.data).find((card) => card.caseId === target.caseId)!;
    expect(finished.kanbanStatus).toBe("done");
    expect(finished.caseStatus).toBe("open"); // پرونده خدمت باز مانده است

    // ۱۰) اقدام نامعتبر پس از اتمام → خطای روشن، بدون تغییر وضعیت
    const invalid = await techClient.call("POST", `/api/v1/ops/cases/${target.caseId}/actions`, { action: "cancel", reason: "دیر شد" });
    expect(invalid.status).toBe(422);
    const still = await admin.get<Board>("/api/v1/ops/board?closed=1");
    expect(cards(still.data).find((card) => card.caseId === target.caseId)!.kanbanStatus).toBe("done");

    // برگرداندن کارت به چرخه (پایان سناریو) — تا اجرای بعدی آزمون از وضعیت روشن شروع کند
    const reopen = await admin.call<{ kanbanStatus: string }>("POST", `/api/v1/ops/cases/${target.caseId}/actions`, {
      action: "rerefer",
      kind: "unit",
      toUnit: "legal",
      reason: "بازگشت به چرخه پس از آزمون پذیرش",
    });
    expect([200, 201]).toContain(reopen.status);
  });

  it("امنیت: کارمند واحد دیگر فقط می‌بیند و نمی‌تواند اقدام کند؛ پرونده ناموجود ۴۰۴ است", async () => {
    const sales = client(salesTicket);
    const board = await sales.get<Board>("/api/v1/ops/board");
    expect(board.status).toBe(200);
    const foreign = cards(board.data).find((card) => !card.canAct);
    expect(foreign).toBeTruthy();

    const view = await sales.get<{ ops: { canAct: boolean; allowedActions: string[] } }>(`/api/v1/ops/cases/${foreign!.caseId}`);
    expect(view.status).toBe(200); // دیدن برای همه کارکنان آزاد است (دسترسی قبلی حفظ شده)
    expect(view.data.ops.canAct).toBe(false);
    expect(view.data.ops.allowedActions).toEqual([]);

    const blocked = await sales.call("POST", `/api/v1/ops/cases/${foreign!.caseId}/actions`, { action: "start_review" });
    expect(blocked.status).toBe(403);
    expect(String(blocked.raw.message)).toContain("مسئول");

    const blockedRefer = await sales.call("POST", `/api/v1/ops/cases/${foreign!.caseId}/refer`, { kind: "unit", toUnit: "finance" });
    expect(blockedRefer.status).toBe(403);

    const missing = await sales.get("/api/v1/ops/cases/case_does_not_exist");
    expect(missing.status).toBe(404);

    // دست‌کاری شناسه پرونده در پیام/اقدام، داده پرونده دیگری را افشا نمی‌کند
    const tampered = await sales.call("POST", "/api/v1/ops/cases/case_does_not_exist/messages", { body: "سلام" });
    expect(tampered.status).toBe(404);
  });

  it("CSRF: درخواست تغییردهنده بدون توکن رد می‌شود", async () => {
    const response = await fetch(`${BASE}/api/v1/ops/notifications`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-ticket": legalTicket },
      body: JSON.stringify({ all: true }),
    });
    expect(response.status).toBe(403);
  });

  it("صندوق اعلان: خوانده‌شدن یک اعلان، شمارنده را کم می‌کند", async () => {
    const tech = client(techTicket);
    const before = await tech.get<{ unread: number; mentions: number }>("/api/v1/ops/notifications/count");
    expect(before.status).toBe(200);
    expect(before.data.unread).toBeGreaterThan(0);

    const inbox = await tech.get<{ items: Array<{ id: string }> }>("/api/v1/ops/notifications?filter=unread");
    const first = inbox.data.items[0];
    const marked = await tech.call<{ marked: number; unread: number }>("POST", "/api/v1/ops/notifications", { ids: [first.id] });
    expect(marked.status).toBe(200);
    expect(marked.data.marked).toBe(1);
    expect(marked.data.unread).toBe(before.data.unread - 1);

    // اعلان کارمند دیگر با شناسه‌اش قابل خواندن/تغییر نیست
    const foreignPage = await client(salesTicket).get<{ items: Array<{ id: string }> }>("/api/v1/ops/notifications?limit=1");
    if (foreignPage.data.items.length) {
      const attempt = await client(salesTicket).call<{ marked: number }>("POST", "/api/v1/ops/notifications", { ids: [first.id] });
      expect(attempt.data.marked).toBe(0);
    }
  });

  it("جدایی داخلی از بیرونی: کانال سینک/کاربر نهایی به پیام‌های داخلی و تخته دسترسی ندارد", async () => {
    // کلید سینک معتبر هم نباید درِ داده داخلی را باز کند (این مسیرها فقط نشست کارمند می‌خواهند)
    const syncKey = process.env.SYNC_API_KEY ?? "change-me-sync-api-key";
    for (const path of ["/api/v1/ops/board", "/api/v1/ops/notifications", "/api/v1/ops/staff"]) {
      const response = await fetch(`${BASE}${path}`, { headers: { accept: "application/json", "x-sync-key": syncKey } });
      expect(response.status).toBe(401);
    }

    // اینگست سرور اصلی با امضای درست: پاسخ فقط نتیجه سینک است و محتوای گفت‌وگوی داخلی در آن نیست
    const syncSecret = process.env.SYNC_SECRET ?? "change-me-hmac-secret";
    const payload = JSON.stringify({ items: [{ external_id: `e2e-user-${Date.now()}`, full_name: "کاربر سینک‌شده", mobile: "09120000000" }] });
    const signature = createHmac("sha256", syncSecret).update(payload, "utf8").digest("hex");
    const ingest = await fetch(`${BASE}/api/v1/ingest/users`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-key": syncKey, "x-signature": `sha256=${signature}` },
      body: payload,
    });
    const body = await ingest.text();
    expect(ingest.status).toBeLessThan(400);
    expect(body).not.toContain("محرمانه");
    expect(body).not.toContain("case_messages");
    expect(body).not.toContain("referralPath");
    expect(body).not.toContain("کانبان");
  });

  it("جابه‌جایی ستون‌ها: ترتیب شخصی ذخیره/بازنشانی می‌شود، ترتیب پیش‌فرض فقط برای مدیر است", async () => {
    const legal = client(legalTicket);
    const tech = client(techTicket);
    const adminClient = client(adminTicket);

    // آزمون خودکفا: از وضعیت تمیز شروع می‌کنیم (مستقل از اجراهای قبلی روی همین دیتابیس)
    const base = await adminClient.call<{ order: string[] }>("PUT", "/api/v1/ops/board/columns", {
      reset: true,
      scope: "default",
    });
    expect(base.status).toBe(200);
    await legal.call("PUT", "/api/v1/ops/board/columns", { reset: true, scope: "personal" });
    await tech.call("PUT", "/api/v1/ops/board/columns", { reset: true, scope: "personal" });
    await adminClient.call("PUT", "/api/v1/ops/board/columns", { reset: true, scope: "personal" });

    const initial = await legal.get<Board>("/api/v1/ops/board");
    expect(initial.status).toBe(200);
    const keys = initial.data.columnOrder;
    expect(keys.length).toBe(initial.data.columns.length);
    expect(initial.data.canSetDefaultOrder).toBe(false);
    expect(initial.data.columnOrderSource).toBe("default");
    expect(initial.data.columnOrder).toEqual(base.data.order);
    expect(keys[0]).not.toBe(keys[1]);

    // کارمند عادی: جابه‌جایی دو ستون اول و ذخیره روی سرور
    const swapped = [keys[1], keys[0], ...keys.slice(2)];
    const saved = await legal.call<{ order: string[]; source: string; canSetDefaultOrder: boolean }>(
      "PUT",
      "/api/v1/ops/board/columns",
      { order: swapped },
    );
    expect(saved.status).toBe(200);
    expect(saved.data.order).toEqual(swapped);
    expect(saved.data.source).toBe("personal");

    // GET تازه همان ترتیب را می‌دهد و ستون‌ها هم با همان ترتیب ساخته می‌شوند
    const after = await legal.get<Board>("/api/v1/ops/board");
    expect(after.data.columnOrder).toEqual(swapped);
    expect(after.data.columnOrderSource).toBe("personal");
    expect(after.data.columns.map((c) => c.unitKey)).toEqual(swapped);
    expect(after.data.units.map((u) => u.key)).toEqual(swapped);

    // همین ترتیب شخصی روی کارمند دیگر اثری ندارد
    const other = await tech.get<Board>("/api/v1/ops/board");
    expect(other.data.columnOrderSource).toBe("default");
    expect(other.data.columnOrder).toEqual(keys);

    // کارمند عادی نمی‌تواند ترتیب پیش‌فرض همه را تغییر دهد
    const forbidden = await legal.call("PUT", "/api/v1/ops/board/columns", { order: swapped, scope: "default" });
    expect(forbidden.status).toBe(403);
    expect(String(forbidden.raw.message)).toContain("مدیر");

    // مدیریت: ترتیب پیش‌فرض همه
    const asDefault = await adminClient.call<{ order: string[]; source: string }>("PUT", "/api/v1/ops/board/columns", {
      order: swapped,
      scope: "default",
    });
    expect(asDefault.status).toBe(200);
    expect(asDefault.data.source).toBe("default");
    const staffView = await client(techTicket).get<Board>("/api/v1/ops/board");
    expect(staffView.data.columnOrder).toEqual(swapped);

    // بازنشانی: ترتیب شخصی این کارمند حذف می‌شود و ترتیب پیش‌فرض به حالت اولیه برمی‌گردد
    const resetPersonal = await legal.call<{ source: string; order: string[] }>("PUT", "/api/v1/ops/board/columns", {
      reset: true,
      scope: "personal",
    });
    expect(resetPersonal.status).toBe(200);
    expect(resetPersonal.data.source).toBe("default");
    const resetDefault = await adminClient.call<{ order: string[] }>("PUT", "/api/v1/ops/board/columns", { reset: true, scope: "default" });
    expect(resetDefault.status).toBe(200);
    expect(resetDefault.data.order).toEqual(base.data.order); // همان ترتیب پیش‌فرض سازمانی
    expect(resetDefault.data.order).not.toEqual(swapped);
    const finalBoard = await tech.get<Board>("/api/v1/ops/board");
    expect(finalBoard.data.columnOrder).toEqual(resetDefault.data.order);
    expect(finalBoard.data.columnOrderSource).toBe("default");
  });

  it("جابه‌جایی ستون‌ها فقط با درگ‌انددراپ است: HTML تخته دکمه یک‌گامه ندارد", async () => {
    const response = await fetch(`${BASE}/panel/kanban`, {
      headers: { "x-session-ticket": legalTicket, accept: "text/html" },
      redirect: "manual",
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    // ستون‌ها قابل کشیدن‌اند و دسته جابه‌جایی دارند
    expect((html.match(/kanban-col-head col-draggable/g) ?? []).length).toBeGreaterThan(4);
    expect(html).toContain("kanban-col-grip");
    expect(html).toContain('draggable="true"');
    // هیچ دکمه/نشانه‌ای برای جابه‌جایی یک‌گامه ستون نمانده است
    expect(html).not.toContain("col-shift-btn");
    expect(html).not.toContain("col-shift");
    expect(html).not.toContain("جابه‌جایی ستون به راست");
    expect(html).not.toContain("جابه‌جایی ستون به چپ");
  });

  it("جابه‌جایی ستون‌ها: ورودی نامعتبر و بدون CSRF رد می‌شود", async () => {
    const legal = client(legalTicket);
    const unknown = await legal.call("PUT", "/api/v1/ops/board/columns", { order: ["unit_does_not_exist"] });
    expect(unknown.status).toBe(400);
    expect(String(unknown.raw.message)).toContain("ناشناخته");

    const duplicate = await legal.get<Board>("/api/v1/ops/board").then((board) =>
      legal.call("PUT", "/api/v1/ops/board/columns", { order: [board.data.columnOrder[0], board.data.columnOrder[0]] }),
    );
    expect(duplicate.status).toBe(400);
    expect(String(duplicate.raw.message)).toContain("تکراری");

    // بدون هدر CSRF هیچ تغییری ثبت نمی‌شود
    const before = (await legal.get<Board>("/api/v1/ops/board")).data.columnOrder;
    const noCsrf = await fetch(`${BASE}/api/v1/ops/board/columns`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-ticket": legalTicket },
      body: JSON.stringify({ order: [...before].reverse() }),
    });
    expect(noCsrf.status).toBe(403);
    const after = (await legal.get<Board>("/api/v1/ops/board")).data.columnOrder;
    expect(after).toEqual(before);

    // بدون نشست هم دسترسی نیست
    const anonymous = await client(null).get("/api/v1/ops/board/columns");
    expect(anonymous.status).toBe(401);
  });

  it("فهرست کارمندان و واحدها برای ارجاع/منشن در دسترس است", async () => {
    const directory = await client(legalTicket).get<{ units: Array<{ key: string; staff: Array<{ id: string; fullName: string }> }> }>(
      "/api/v1/ops/staff",
    );
    expect(directory.status).toBe(200);
    expect(directory.data.units.length).toBeGreaterThan(4);
    const technical = directory.data.units.find((u) => u.key === "technical")!;
    expect(technical.staff.length).toBeGreaterThan(0);
  });
});
