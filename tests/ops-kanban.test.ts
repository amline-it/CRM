/**
 * آزمون‌های پذیرش «کانبان عملیات، ارجاع، گفت‌وگوی داخلی و اعلان‌ها».
 *
 * سناریوها: ارجاع بین واحدها و درون واحد، صف واحد بدون مسئول، زنجیره ارجاع،
 * پیام و منشن، جدایی پیام داخلی از پیام مشتری، اثر نداشتن اتمام عملیات بر وضعیت
 * خدمت، idempotency و اعتبارسنجی گذار وضعیت.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ops-"));
process.env.DATABASE_PATH = path.join(tmpDir, "crm.db");
process.env.MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

type ClientModule = typeof import("@/db/client");
type CasesModule = typeof import("@/db/repos/cases");
type PeopleModule = typeof import("@/db/repos/people");
type ReferralsModule = typeof import("@/db/repos/referrals");
type PlatformModule = typeof import("@/db/repos/platform");
type ConvModule = typeof import("@/db/repos/conversations");
type SvcModule = typeof import("@/domain/service/referral-service");
type ColumnsModule = typeof import("@/domain/service/board-columns");
type BoardOrderModule = typeof import("@/lib/board-order");
type ConvSvcModule = typeof import("@/domain/service/conversation-service");
type NotifyModule = typeof import("@/domain/service/ops-notify");
type Actor = { type: "staff" | "admin"; id: string; name: string };

let client: ClientModule;
let Cases: CasesModule;
let People: PeopleModule;
let Referrals: ReferralsModule;
let Platform: PlatformModule;
let Conv: ConvModule;
let Svc: SvcModule;
let Columns: ColumnsModule;
let BoardOrder: BoardOrderModule;
let ConvSvc: ConvSvcModule;
let Notify: NotifyModule;

let salesStaff: string;
let legalStaff: string;
let legalStaff2: string;
let financeStaff: string;
let inactiveStaff: string;

const sales: Actor = { type: "staff", id: "", name: "کارشناس فروش" };
const legal: Actor = { type: "staff", id: "", name: "کارشناس حقوقی" };
const admin: Actor = { type: "admin", id: "adm-1", name: "مدیر" };

function newCase(title: string, priority: "normal" | "high" = "normal"): string {
  return Cases.createCase({
    serviceKey: "contract",
    workflowKey: "contract",
    workflowVersion: 1,
    state: "contract_start",
    title,
    priority,
    assignedStaffId: salesStaff,
  });
}

beforeAll(async () => {
  client = await import("@/db/client");
  const migrate = await import("@/db/migrate");
  migrate.ensureMigrated();
  Cases = await import("@/db/repos/cases");
  People = await import("@/db/repos/people");
  Referrals = await import("@/db/repos/referrals");
  Platform = await import("@/db/repos/platform");
  Conv = await import("@/db/repos/conversations");
  Svc = await import("@/domain/service/referral-service");
  Columns = await import("@/domain/service/board-columns");
  BoardOrder = await import("@/lib/board-order");
  ConvSvc = await import("@/domain/service/conversation-service");
  Notify = await import("@/domain/service/ops-notify");

  for (const [key, name] of [
    ["sales", "واحد فروش"],
    ["legal", "واحد حقوقی"],
    ["finance", "واحد مالی"],
  ] as const) {
    if (!Referrals.getOrgUnit(key)) Referrals.createOrgUnit({ key, name });
  }

  salesStaff = People.createStaff({ username: "sales1", fullName: "سارا فروش", role: "staff", passwordHash: "x", orgUnit: "sales" });
  legalStaff = People.createStaff({ username: "legal1", fullName: "مریم حقوقی", role: "staff", passwordHash: "x", orgUnit: "legal" });
  legalStaff2 = People.createStaff({ username: "legal2", fullName: "امیر حقوقی", role: "staff", passwordHash: "x", orgUnit: "legal" });
  financeStaff = People.createStaff({ username: "fin1", fullName: "حسین مالی", role: "staff", passwordHash: "x", orgUnit: "finance" });
  inactiveStaff = People.createStaff({ username: "off1", fullName: "کارمند غیرفعال", role: "staff", passwordHash: "x", orgUnit: "legal" });

  sales.id = salesStaff;
  legal.id = legalStaff;
});

afterAll(() => {
  try {
    client.closeDb();
  } catch {
    /* noop */
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("۱) ارجاع قرارداد از فروش به حقوقی و نمایش کارت در ستون حقوقی", () => {
  it("کارت پس از ارجاع در ستون واحد مقصد دیده می‌شود و از ستون قبلی حذف می‌شود", () => {
    const caseId = newCase("قرارداد اجاره نمونه");
    const result = Svc.referCase({ caseId, actor: sales, kind: "unit", toUnit: "legal", reason: "بررسی بندهای حقوقی" });

    expect(result.toUnit).toBe("legal");
    expect(result.toStaffId).toBeNull();
    expect(result.kanbanStatus).toBe("new");

    const board = Svc.buildBoard({ id: legalStaff, role: "staff", unit: "legal", name: "کارشناس حقوقی" });
    const legalColumn = board.columns.find((c) => c.unitKey === "legal")!;
    const salesColumn = board.columns.find((c) => c.unitKey === "sales")!;

    expect(legalColumn.cards.some((c) => c.caseId === caseId)).toBe(true);
    expect(salesColumn.cards.some((c) => c.caseId === caseId)).toBe(false);

    const card = legalColumn.cards.find((c) => c.caseId === caseId)!;
    expect(card.hasOwner).toBe(false);
    expect(card.currentUnitName).toBe("واحد حقوقی");
    expect(card.referralPath[0].reason).toBe("بررسی بندهای حقوقی");
    expect(card.referralPath[0].fromUnit).toBe("sales");
    expect(card.referralPath[0].statusBefore).toBe("new");
    expect(card.referralPath[0].statusAfter).toBe("new");
    expect(card.canAct).toBe(true); // کارمند همان واحد جاری
  });

  it("کارمند واحد دیگر اجازه اقدام ندارد", () => {
    const caseId = newCase("قرارداد بدون دسترسی");
    Svc.referCase({ caseId, actor: sales, kind: "unit", toUnit: "legal" });
    const financeActor = { type: "staff" as const, id: financeStaff, name: "حسین مالی" };
    expect(() => Svc.actOnCard({ caseId, actor: financeActor, action: "start_review" })).toThrow(/مسئول/);
  });
});

describe("۲) ارجاع به همکار دیگر در همان واحد", () => {
  it("مسئول تغییر می‌کند ولی ستون واحد ثابت می‌ماند", () => {
    const caseId = newCase("قرارداد درون واحد");
    Svc.referCase({ caseId, actor: sales, kind: "unit", toUnit: "legal", reason: "ورود به واحد حقوقی" });
    const before = Svc.getCaseOps(caseId, legal);
    expect(before.currentUnit).toBe("legal");
    expect(before.hasOwner).toBe(false);

    Svc.referCase({
      caseId,
      actor: { type: "admin", id: admin.id, name: admin.name },
      kind: "colleague",
      toStaffId: legalStaff2,
      reason: "تقسیم کار در همان واحد",
    });

    const after = Svc.getCaseOps(caseId, legal);
    expect(after.currentUnit).toBe("legal");
    expect(after.assignedStaffId).toBe(legalStaff2);
    expect(after.hasOwner).toBe(true);
    expect(after.referralPath).toHaveLength(2);
    expect(after.referralPath[1].kind).toBe("colleague");
    expect(after.referralPath[1].toName).toBe("امیر حقوقی");
  });

  it("ارجاع به همکار بدون واحد سازمانی رد می‌شود", () => {
    const noUnit = People.createStaff({ username: "nounit", fullName: "بدون واحد", role: "staff", passwordHash: "x" });
    const caseId = newCase("قرارداد بدون واحد مقصد");
    expect(() =>
      Svc.referCase({ caseId, actor: { type: "admin", id: admin.id, name: admin.name }, kind: "colleague", toStaffId: noUnit }),
    ).toThrow(/واحد سازمانی/);
  });
});

describe("۳) ارجاع به واحد بدون انتخاب فرد (صف واحد)", () => {
  it("کارت بدون مسئول در صف واحد دیده می‌شود و به فرد قبلی نسبت داده نمی‌شود", () => {
    const caseId = newCase("عملیات صف واحد");
    Svc.referCase({ caseId, actor: sales, kind: "colleague", toStaffId: legalStaff, reason: "واگذاری به همکار" });
    Svc.referCase({ caseId, actor: { type: "admin", id: admin.id, name: admin.name }, kind: "unit", toUnit: "finance", reason: "صف مالی" });

    const board = Svc.buildBoard({ id: admin.id, role: "admin", unit: null, name: "مدیر" });
    const card = board.columns.flatMap((c) => c.cards).find((c) => c.caseId === caseId)!;
    expect(card.currentUnit).toBe("finance");
    expect(card.assignedStaffId).toBeNull();
    expect(card.hasOwner).toBe(false);
    expect(board.stats.unassigned).toBeGreaterThan(0);

    // اعلان صف برای کارکنان همان واحد ساخته شده است
    const financeInbox = Platform.listInbox(financeStaff, { unreadOnly: true });
    expect(financeInbox.some((row) => row.kind === "referral.queue" && row.case_id === caseId)).toBe(true);
  });
});

describe("۴) ارجاع مجدد و حفظ کامل زنجیره", () => {
  it("هر ارجاع یک ردیف تازه است و سابقه قبلی بازنویسی نمی‌شود", () => {
    const caseId = newCase("زنجیره ارجاع");
    Svc.referCase({ caseId, actor: sales, kind: "unit", toUnit: "legal", reason: "گام ۱" });
    Svc.referCase({ caseId, actor: legal, kind: "colleague", toStaffId: legalStaff2, reason: "گام ۲" });
    Svc.actOnCard({ caseId, actor: admin, action: "rerefer", kind: "unit", toUnit: "finance", reason: "گام ۳" });

    const path = Referrals.listReferralsForCase(caseId);
    expect(path.map((r) => r.to_unit)).toEqual(["legal", "legal", "finance"]);
    expect(path.map((r) => r.depth)).toEqual([1, 2, 3]);
    expect(path[0].reason).toBe("گام ۱");
    expect(path[1].reason).toBe("گام ۲");
    expect(path[2].reason).toBe("گام ۳");

    const ops = Svc.getCaseOps(caseId, admin);
    expect(ops.referralPath.map((n) => n.reason)).toEqual(["گام ۱", "گام ۲", "گام ۳"]);
    expect(ops.currentUnit).toBe("finance");
  });
});

describe("۵) پیام داخلی، منشن و اعلان", () => {
  it("پیام ثبت می‌شود، منشن‌شده اعلان می‌گیرد و پیام روی کارت شمرده می‌شود", () => {
    const caseId = newCase("گفت‌وگوی داخلی");
    Svc.referCase({ caseId, actor: sales, kind: "unit", toUnit: "legal", reason: "بررسی" });

    const result = ConvSvc.postMessage({
      caseId,
      actor: legal,
      body: "@امیر حقوقی لطفاً بند ۳ را بازبینی کن",
      mentionStaffIds: [legalStaff2],
    });

    expect(result.mentioned).toContain(legalStaff2);
    expect(result.notified).toBeGreaterThan(0);
    expect(Conv.listMentionsForMessage(result.message.id)).toHaveLength(1);

    const mentions = Platform.listInbox(legalStaff2, { unreadOnly: true }).filter((row) => row.kind === "mention");
    expect(mentions).toHaveLength(1);
    expect(mentions[0].case_id).toBe(caseId);
    expect(mentions[0].link).toContain(`/panel/cases/${caseId}`);
    expect(Conv.countUnreadMentions(legalStaff2)).toBe(1);

    // منشن مسئولیت را منتقل نمی‌کند
    const ops = Svc.getCaseOps(caseId, legal);
    expect(ops.assignedStaffId).toBeNull();

    // شمارنده پیام خوانده‌نشده روی کارت
    const board = Svc.buildBoard({ id: legalStaff2, role: "staff", unit: "legal", name: "امیر" });
    const card = board.columns.flatMap((c) => c.cards).find((c) => c.caseId === caseId)!;
    expect(card.unreadMessages).toBe(1);

    ConvSvc.getConversation(caseId, { type: "staff", id: legalStaff2, name: "امیر" }, { markRead: true });
    expect(Conv.unreadCountsByCase(legalStaff2, [caseId])[caseId]).toBeUndefined();
  });

  it("منشن به کارمند غیرفعال اعلان نمی‌سازد", () => {
    People.updateStaff(inactiveStaff, { active: false });
    const caseId = newCase("منشن غیرفعال");
    const result = ConvSvc.postMessage({
      caseId,
      actor: legal,
      body: "متن بدون منشن",
      mentionStaffIds: [inactiveStaff],
    });
    expect(result.mentioned).not.toContain(inactiveStaff);
    expect(Conv.listMentionsForMessage(result.message.id)).toHaveLength(0);
    expect(Platform.listInbox(inactiveStaff).filter((row) => row.kind === "mention")).toHaveLength(0);
    expect(Platform.listInbox(inactiveStaff, { unreadOnly: true }).filter((row) => row.kind === "mention")).toHaveLength(0);
  });

  it("ویرایش و حذف پیام، تاریخچه حسابرسی را نگه می‌دارد", () => {
    const caseId = newCase("ویرایش پیام");
    const posted = ConvSvc.postMessage({ caseId, actor: legal, body: "نسخه اول" });
    const edited = ConvSvc.editMessage({ messageId: posted.message.id, actor: legal, body: "نسخه دوم" });
    expect(edited.body).toBe("نسخه دوم");
    expect(edited.editedAt).toBeTruthy();

    const audit = Platform.listAudit(50).filter((row) => row.action.startsWith("ops.message"));
    expect(audit.some((row) => row.action === "ops.message.edit" && (row.detail ?? "").includes("نسخه اول"))).toBe(true);

    ConvSvc.deleteMessage({ messageId: posted.message.id, actor: legal });
    const row = Conv.findMessageById(posted.message.id)!;
    expect(row.deleted_at).toBeTruthy();
    expect(row.body).toBe("نسخه دوم"); // محتوا برای حسابرسی باقی می‌ماند
  });

  it("ویرایش پیام دیگران توسط کارمند عادی رد می‌شود", () => {
    const caseId = newCase("ویرایش غیرمجاز");
    const posted = ConvSvc.postMessage({ caseId, actor: legal, body: "پیام حقوقی" });
    expect(() => ConvSvc.editMessage({ messageId: posted.message.id, actor: sales, body: "دست‌کاری" })).toThrow(/نویسنده/);
  });
});

describe("۸) جدایی پیام‌های داخلی از پیام‌های مشتری", () => {
  it("گزارش پیام‌های بیرونی هیچ اعلان/پیام داخلی را نشان نمی‌دهد", () => {
    const caseId = newCase("محرمانگی داخلی");
    Platform.insertNotification({
      channel: "sms",
      template: "documents_required",
      toUserId: "usr-1",
      toAddress: "09120000000",
      caseId,
      body: "پیام مشتری: مدارک را بارگذاری کنید",
    });
    const internal = ConvSvc.postMessage({ caseId, actor: legal, body: "یادداشت محرمانه کارکنان" });
    const internalInbox = Platform.insertInboxNotification({
      staffId: legalStaff,
      kind: "message.new",
      template: "message.new",
      body: "پیام تازه در گفت‌وگو",
      caseId,
      link: `/panel/cases/${caseId}`,
      dedupeKey: "ops:test:confidential",
    });

    const outward = Platform.listNotifications(caseId);
    expect(outward.some((row) => row.channel === "sms")).toBe(true);
    expect(outward.every((row) => !row.to_staff_id)).toBe(true);
    expect(outward.every((row) => !row.body.includes("محرمانه"))).toBe(true);
    expect(outward.every((row) => row.id !== internalInbox.id)).toBe(true);
    expect(outward.every((row) => row.id !== internal.message.id)).toBe(true);
    // با includeInternal، همان ردیف داخلی دیده می‌شود؛ یعنی فیلتر پیش‌فرض است که آن را پنهان می‌کند
    expect(Platform.listNotifications(caseId, 100, { includeInternal: true }).some((row) => row.id === internalInbox.id)).toBe(true);

    const staffInbox = Platform.listInbox(legalStaff);
    expect(staffInbox.some((row) => row.body.includes("پیام تازه"))).toBe(true);
    expect(Conv.listMessages(caseId).some((row) => row.body.includes("محرمانه"))).toBe(true);
  });
});

describe("۹) اتمام عملیات داخلی وضعیت خدمت را تغییر نمی‌دهد", () => {
  it("kanban_status به done می‌رود ولی state/status پرونده دست‌نخورده می‌ماند", () => {
    const caseId = newCase("قرارداد پایان عملیات داخلی");
    const before = Cases.findCaseById(caseId)!;
    Svc.actOnCard({ caseId, actor: admin, action: "complete" });
    const after = Cases.findCaseById(caseId)!;

    expect(after.kanban_status).toBe("done");
    expect(after.state).toBe(before.state);
    expect(after.status).toBe("open");
    expect(after.outcome).toBe(before.outcome);
  });

  it("لغو عملیات علت الزامی دارد و وضعیت پرونده را نمی‌بندد", () => {
    const caseId = newCase("قرارداد لغو عملیات");
    expect(() => Svc.actOnCard({ caseId, actor: admin, action: "cancel" })).toThrow(/علت/);
    Svc.actOnCard({ caseId, actor: admin, action: "cancel", reason: "انصراف مشتری" });
    const row = Cases.findCaseById(caseId)!;
    expect(row.kanban_status).toBe("cancelled");
    expect(row.status).toBe("open");
  });
});

describe("۱۰) جلوگیری از ارجاع و اعلان تکراری", () => {
  it("درخواست تکراری با همان کلید idempotency، ارجاع و اعلان تازه نمی‌سازد", () => {
    const caseId = newCase("ارجاع تکراری");
    const first = Svc.referCase({
      caseId,
      actor: sales,
      kind: "unit",
      toUnit: "legal",
      reason: "یک‌بار",
      idempotencyKey: "req-1",
    });
    const inboxBefore = Platform.listInbox(legalStaff).length;
    const second = Svc.referCase({
      caseId,
      actor: sales,
      kind: "unit",
      toUnit: "legal",
      reason: "یک‌بار",
      idempotencyKey: "req-1",
    });

    expect(second.referralId).toBe(first.referralId);
    expect(second.replayed).toBe(true);
    expect(Referrals.listReferralsForCase(caseId)).toHaveLength(1);
    expect(Platform.listInbox(legalStaff).length).toBe(inboxBefore);

    // اعلان با کلید dedupe تکراری ساخته نمی‌شود
    const duplicate = Platform.insertInboxNotification({
      staffId: legalStaff,
      kind: "referral.queue",
      template: "referral.queue",
      body: "تکراری",
      caseId,
      dedupeKey: "ops:test:dedupe",
    });
    const again = Platform.insertInboxNotification({
      staffId: legalStaff,
      kind: "referral.queue",
      template: "referral.queue",
      body: "تکراری",
      caseId,
      dedupeKey: "ops:test:dedupe",
    });
    expect(again.id).toBe(duplicate.id);
    expect(again.created).toBe(false);
  });
});

describe("۱۱) اعتبارسنجی گذار و خطای قابل فهم", () => {
  it("گذار نامعتبر رد می‌شود و وضعیت معتبر قبلی تغییر نمی‌کند", () => {
    const caseId = newCase("گذار نامعتبر");
    Svc.actOnCard({ caseId, actor: admin, action: "complete" });
    expect(Cases.findCaseById(caseId)!.kanban_status).toBe("done");

    expect(() => Svc.actOnCard({ caseId, actor: admin, action: "cancel", reason: "دیر شد" })).toThrow(/مجاز نیست/);
    expect(Cases.findCaseById(caseId)!.kanban_status).toBe("done");

    // اقدام روی پرونده ناموجود → خطای ۴۰۴ قابل فهم
    try {
      Svc.actOnCard({ caseId: "case_missing", actor: admin, action: "start_review" });
      throw new Error("نباید به اینجا برسد");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("NOT_FOUND");
    }
  });

  it("پرونده بسته‌شده ارجاع و پیام نمی‌پذیرد", () => {
    const caseId = newCase("پرونده بسته");
    Cases.updateCase(caseId, { status: "closed", closed_at: new Date().toISOString() });
    expect(() => Svc.referCase({ caseId, actor: admin, kind: "unit", toUnit: "legal" })).toThrow(/بسته/);
    expect(() => ConvSvc.postMessage({ caseId, actor: admin, body: "پیام" })).toThrow(/بسته/);
  });
});

describe("۱۲) حفظ دسترسی‌های قبلی کارکنان", () => {
  it("مجوزهای پایه کارشناس دست‌نخورده است و نقش جدیدی ساخته نشده", async () => {
    const { can, permissionsOf } = await import("@/auth/rbac");
    for (const permission of ["case.view", "case.create", "case.transition", "user.view", "referral.create", "report.view"] as const) {
      expect(can("staff", permission)).toBe(true);
    }
    expect(can("staff", "referral.manage")).toBe(false);
    expect(can("admin", "referral.manage")).toBe(true);
    expect(permissionsOf("staff").every((p) => permissionsOf("admin").includes(p))).toBe(true);
  });

  it("سرویس کانبان برای همه کارکنان فعال قابل مشاهده است (بدون محدودسازی ناخواسته)", () => {
    const caseId = newCase("مشاهده کارمند دیگر واحد");
    const ops = Svc.getCaseOps(caseId, { type: "staff", id: financeStaff, name: "مالی" });
    expect(ops.caseId).toBe(caseId);
    expect(ops.canAct).toBe(false); // می‌بیند ولی اقدام نمی‌کند
  });
});

describe("۴-الف) تبدیل تاریخ جلالی (ورودی مهلت و نمایش)", () => {
  it("تبدیل دوطرفه با تقویم فارسی مطابق است و سال را جابه‌جا نمی‌کند", async () => {
    const { toJalali, toJalaliParts, fromJalaliParts, parseJalaliInput } = await import("@/lib/jalali");
    // مقایسه الگوریتم با Intl (تقویم persian) روی بازه‌ای از تاریخ‌ها
    for (let year = 2020; year <= 2110; year += 1) {
      const dates = [new Date(Date.UTC(year, 2, 21)), new Date(Date.UTC(year, 9, 20)), new Date(Date.UTC(year, 11, 31))];
      for (const date of dates) {
        const parts = toJalaliParts(date);
        expect(`${parts.jy}/${String(parts.jm).padStart(2, "0")}/${String(parts.jd).padStart(2, "0")}`).toBe(
          toJalali(date, { fa: false }),
        );
        const back = fromJalaliParts(parts.jy, parts.jm, parts.jd);
        expect(back.toISOString()).toBe(date.toISOString());
      }
    }
    // سال کبیسه: ۳۰ اسفند ۱۴۰۳ معتبر، ۳۰ اسفند ۱۴۰۴ نامعتبر (روز اول ۱۴۰۵ است)
    expect(parseJalaliInput("۱۴۰۳/۱۲/۳۰")).toBe("2025-03-20T00:00:00.000Z");
    expect(parseJalaliInput("۱۴۰۴/۱۲/۳۰")).toBeNull();
    expect(parseJalaliInput("۱۴۰۵/۱۳/۰۱")).toBeNull();
  });
});

describe("۴-ب) پذیرش قالب‌های مهلت ارسالی از فرم‌ها", () => {
  it("ISO، datetime-local و تاریخ جلالی فارسی را می‌پذیرد و ورودی نامعتبر را رد می‌کند", () => {
    expect(Svc.parseDueAt(null)).toBeNull();
    expect(Svc.parseDueAt("   ")).toBeNull();
    expect(Svc.parseDueAt("2026-10-20T14:30:00.000Z")).toBe("2026-10-20T14:30:00.000Z");
    expect(Svc.parseDueAt("2026-10-20T14:30")).toMatch(/^2026-10-20T/); // قالب datetime-local فرم
    const jalali = Svc.parseDueAt("۱۴۰۵/۰۷/۳۰")!; // همان چیزی که کاربر در فرم فارسی می‌نویسد
    expect(jalali).toMatch(/^2026-10-22T/);
    expect(Svc.parseDueAt("۱۴۰۵-۰۷-۳۰")).toBe(jalali);
    expect(() => Svc.parseDueAt("فردا")).toThrow(/مهلت/);

    // در ارجاع واقعی هم مهلت جلالی به ISO تبدیل و ذخیره می‌شود
    const caseId = newCase("مهلت جلالی");
    const result = Svc.referCase({ caseId, actor: sales, kind: "unit", toUnit: "legal", dueAt: "۱۴۰۵/۰۸/۰۱" });
    expect(result.toUnit).toBe("legal");
    expect(Cases.findCaseById(caseId)!.due_at).toMatch(/^2026-10-23T/);
    const latest = Referrals.latestReferralForCase(caseId)!;
    expect(latest.due_at).toMatch(/^2026-10-23T/);
  });
});

describe("اعلان سررسید (نزدیک/عبور از مهلت)", () => {
  it("اعلان سررسید با اجرای مکرر تکرار نمی‌شود", () => {
    const caseId = newCase("عملیات با مهلت گذشته");
    Svc.referCase({ caseId, actor: sales, kind: "unit", toUnit: "legal", reason: "با مهلت" });
    Cases.updateCase(caseId, { due_at: new Date(Date.now() - 3600_000).toISOString() });

    const first = Notify.sweepDueOps();
    expect(first.overdue).toBeGreaterThan(0);
    const overdueRows = Platform.listInbox(legalStaff).filter((row) => row.kind === "ops.overdue" && row.case_id === caseId);
    expect(overdueRows).toHaveLength(1);

    const second = Notify.sweepDueOps();
    expect(second.overdue).toBe(0);
    expect(Platform.listInbox(legalStaff).filter((row) => row.kind === "ops.overdue" && row.case_id === caseId)).toHaveLength(1);
  });

  it("برای مسئول مشخص فقط اعلان همان فرد ساخته می‌شود", () => {
    const caseId = newCase("سررسید با مسئول");
    Svc.referCase({ caseId, actor: sales, kind: "colleague", toStaffId: legalStaff, reason: "به مسئول" });
    Cases.updateCase(caseId, { due_at: new Date(Date.now() + 2 * 3600_000).toISOString() });
    const result = Notify.sweepDueOps();
    expect(result.dueSoon).toBeGreaterThan(0);
    expect(Platform.listInbox(legalStaff).some((row) => row.kind === "ops.due_soon" && row.case_id === caseId)).toBe(true);
    expect(Platform.listInbox(legalStaff2).some((row) => row.case_id === caseId && row.kind === "ops.due_soon")).toBe(false);
  });
});

describe("۱۳) سازگاری ردیف‌های پایگاه‌داده با مرز سرور→کلاینت", () => {
  it("ردیف‌های برگشتی از مخازن، شیء ساده‌اند (نه شیء با پروتوتایپ null)", () => {
    const caseId = newCase("شیء ساده برای کلاینت");
    ConvSvc.postMessage({ caseId, actor: legal, body: "پیام برای بررسی نوع ردیف" });
    Platform.insertInboxNotification({
      staffId: legalStaff,
      kind: "message.new",
      template: "message.new",
      body: "ردیف اعلان",
      caseId,
      link: `/panel/cases/${caseId}`,
      dedupeKey: "ops:test:plain-object",
    });

    const rows = [
      Cases.findCaseById(caseId)!,
      Conv.listMessages(caseId)[0],
      Platform.listInbox(legalStaff)[0],
      Referrals.listReferralsForCase(caseId)[0],
    ].filter(Boolean);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
      expect(Object.getPrototypeOf({ ...row })).toBe(Object.prototype);
    }
  });
});

describe("۱۴) جابه‌جایی و چیدمان ستون‌های کانبان", () => {
  const viewer = (id: string, name = "بیننده") => ({ id, role: "staff" as const, unit: null, name });
  const manager = { id: admin.id, role: "admin" as const, unit: null, name: admin.name };

  it("ترتیب پیش‌فرض از sort_order واحدها می‌آید و همه ستون‌ها را در بر می‌گیرد", () => {
    const keys = Referrals.listOrgUnits().map((u) => u.key);
    const board = Svc.buildBoard(manager);
    expect(board.columnOrder).toEqual(keys);
    expect(board.columnOrderSource).toBe("default");
    expect(board.canSetDefaultOrder).toBe(true);
    // ستون‌ها دقیقاً به همین ترتیب ساخته می‌شوند (هر واحد یک ستون)
    expect(board.columns.map((c) => c.unitKey)).toEqual(keys);
    expect(Svc.buildBoard(viewer(legalStaff)).canSetDefaultOrder).toBe(false);
  });

  it("ترتیب پیش‌فرض تیم: ذخیره → sort_order واحدها به‌روزرسانی می‌شود و برای همه اعمال است", () => {
    const original = Referrals.listOrgUnits().map((u) => u.key);
    const reversed = [...original].reverse();
    const applied = Columns.saveDefaultColumnOrder(reversed);
    expect(applied).toEqual(reversed);
    expect(Referrals.listOrgUnits().map((u) => u.key)).toEqual(reversed);
    for (const board of [Svc.buildBoard(manager), Svc.buildBoard(viewer(legalStaff)), Svc.buildBoard(viewer(legalStaff2))]) {
      expect(board.columnOrder).toEqual(reversed);
      expect(board.columns.map((c) => c.unitKey)).toEqual(reversed);
    }
    expect(Columns.saveDefaultColumnOrder(original)).toEqual(original); // بازگشت به حالت اول
  });

  it("چیدمان شخصی: روی بیننده اثر دارد، روی دیگران نه، و با واحد حذف‌شده/تازه خراب نمی‌شود", () => {
    const keys = Referrals.listOrgUnits().map((u) => u.key);
    const personal = [keys[2], keys[0], keys[1]];
    Columns.savePersonalColumnOrder(legalStaff, personal);

    const mine = Svc.buildBoard(viewer(legalStaff, "من"));
    expect(mine.columnOrderSource).toBe("personal");
    expect(mine.columnOrder.slice(0, 3)).toEqual(personal);
    expect(mine.columnOrder).toHaveLength(keys.length); // بقیه واحدها به انتها اضافه می‌شوند
    expect(new Set(mine.columnOrder).size).toBe(keys.length);
    expect(mine.columns.map((c) => c.unitKey)).toEqual(mine.columnOrder);

    const other = Svc.buildBoard(viewer(legalStaff2, "دیگری"));
    expect(other.columnOrderSource).toBe("default");
    expect(other.columnOrder).toEqual(keys);

    // کلید واحد حذف‌شده در تنظیمات ذخیره‌شده: نادیده گرفته می‌شود و همیشه همه ستون‌ها دیده می‌شوند
    Platform.setSetting(`ops.board.columns.${legalStaff}`, ["unit_ghost", keys[1], keys[0]]);
    const afterDelete = Svc.buildBoard(viewer(legalStaff, "من"));
    expect(afterDelete.columnOrder).toHaveLength(keys.length);
    expect(afterDelete.columnOrder.slice(0, 2)).toEqual([keys[1], keys[0]]);
    expect(afterDelete.columnOrder).not.toContain("unit_ghost");
    expect(new Set(afterDelete.columnOrder).size).toBe(keys.length);

    // بازنشانی چیدمان شخصی
    Columns.clearPersonalColumnOrder(legalStaff);
    const reset = Svc.buildBoard(viewer(legalStaff, "من"));
    expect(reset.columnOrderSource).toBe("default");
    expect(reset.columnOrder).toEqual(keys);
  });

  it("اعتبارسنجی ورودی: کلید تکراری، واحد ناشناخته و ورودی نادرست رد می‌شوند", () => {
    const keys = Referrals.listOrgUnits().map((u) => u.key);
    expect(() => Columns.parseColumnOrder(undefined)).toThrow(/آرایه/);
    expect(() => Columns.parseColumnOrder([])).toThrow(/خالی/);
    expect(() => Columns.parseColumnOrder([keys[0], keys[0]])).toThrow(/تکراری/);
    expect(() => Columns.parseColumnOrder([keys[0], ""])).toThrow(/نامعتبر/);
    expect(Columns.parseColumnOrder([keys[1], keys[0]])).toEqual([keys[1], keys[0]]);
    expect(() => Columns.saveDefaultColumnOrder(["unit_unknown"])).toThrow(/ناشناخته/);
    expect(() => Columns.savePersonalColumnOrder(legalStaff, ["unit_unknown"])).toThrow(/ناشناخته/);
    // تنظیمات خرابذخیره‌شده (رشته/عدد) → ترتیب شخصی نادیده گرفته می‌شود
    Platform.setSetting(`ops.board.columns.${legalStaff}`, "legal,finance");
    expect(Columns.readPersonalColumnOrder(legalStaff)).toBeNull();
  });

  it("ثبت ترتیب پیش‌فرض تیم، چیدمان شخصی همان مدیر را پاک می‌کند تا پیش‌فرض تازه را ببیند", () => {
    const keys = Referrals.listOrgUnits().map((u) => u.key);
    const viewer = { id: "stf_test_admin_view", role: "staff" as const, unit: null, name: "بیننده مدیر" };
    try {
      // مدیر اول چیدمان شخصی دارد (مثلاً با درگ ستون‌ها)
      Columns.savePersonalColumnOrder(viewer.id, [keys[2], keys[1], keys[0]]);
      expect(Columns.readPersonalColumnOrder(viewer.id)).toEqual([keys[2], keys[1], keys[0]]);

      const teamOrder = [keys[1], keys[2], keys[0]];
      const applied = Columns.applyTeamColumnOrder(teamOrder, viewer.id);
      expect(applied.slice(0, 3)).toEqual(teamOrder);

      // چیدمان شخصی پاک شده و ترتیب مشترک برای همه (از جمله خودش) دیده می‌شود
      expect(Columns.readPersonalColumnOrder(viewer.id)).toBeNull();
      expect(Columns.columnLayout(viewer.id).source).toBe("default");
      expect(Columns.columnLayout(legalStaff2).source).toBe("default");
      expect(Referrals.listOrgUnits().map((u) => u.key).slice(0, 3)).toEqual(teamOrder);
    } finally {
      Columns.clearPersonalColumnOrder(viewer.id);
      Columns.saveDefaultColumnOrder(keys); // بازگشت به ترتیب اولیه برای بقیه آزمون‌ها
    }
    expect(Referrals.listOrgUnits().map((u) => u.key)).toEqual(keys);
  });

  it("کارت‌ها با جابه‌جایی ستون‌ها جابه‌جا نمی‌شوند (ستون = واحد مقصد، نه شکل ذخیره‌سازی)", () => {
    const caseId = newCase("کارت پایدار در ستون");
    Svc.referCase({ caseId, actor: sales, kind: "unit", toUnit: "legal", reason: "چیدمان ستون‌ها" });
    const keys = Referrals.listOrgUnits().map((u) => u.key);
    Columns.savePersonalColumnOrder(financeStaff, [...keys].reverse());
    const board = Svc.buildBoard(viewer(financeStaff, "مالی"));
    const column = board.columns.find((c) => c.unitKey === "legal")!;
    expect(column.cards.some((c) => c.caseId === caseId)).toBe(true);
    expect(board.columnOrder[0]).toBe(keys[keys.length - 1]); // ستون اول جابه‌جا شده
  }, 20000);
});

describe("۱۵) محاسبه جابه‌جایی ستون‌ها (فقط درگ‌انددراپ) — منطق مشترک کلاینت/سرور", () => {
  const order = ["a", "b", "c", "d"];

  it("رهاکردن ستون روی ستون دیگر، آن را پیش از مقصد درج می‌کند", () => {
    expect(BoardOrder.moveColumnKey(order, "d", "a")).toEqual(["d", "a", "b", "c"]); // آخر → اول
    expect(BoardOrder.moveColumnKey(order, "a", "d")).toEqual(["b", "c", "a", "d"]); // اول → پیش از آخرین
    expect(BoardOrder.moveColumnKey(order, "a", "c")).toEqual(["b", "a", "c", "d"]);
    expect(BoardOrder.moveColumnKey(order, "b", "c")).toEqual(["a", "b", "c", "d"]);
    expect(BoardOrder.moveColumnKey(order, "c", "b")).toEqual(["a", "c", "b", "d"]);
  });

  it("جابه‌جایی روی خودش، کلید ناموجود و آرایه تک‌عضوی، ترتیب را تغییر نمی‌دهد", () => {
    expect(BoardOrder.moveColumnKey(order, "b", "b")).toEqual(order);
    expect(BoardOrder.moveColumnKey(order, "x", "a")).toEqual(order);
    expect(BoardOrder.moveColumnKey(order, "a", "x")).toEqual(order);
    expect(BoardOrder.moveColumnKey(["only"], "only", "only")).toEqual(["only"]);
    const snapshot = [...order];
    BoardOrder.moveColumnKey(order, "a", "b");
    expect(order).toEqual(snapshot); // تابع خالص است و آرایه ورودی را دست نمی‌زند
  });

  it("درگ‌انددراپ تنها راه جابه‌جایی است: رهاکردن روی اولین/آخرین/میانی درست درج می‌کند", () => {
    expect(BoardOrder.moveColumnKey(order, "c", "a")).toEqual(["c", "a", "b", "d"]); // روی اولین ستون
    expect(BoardOrder.moveColumnKey(order, "b", "d")).toEqual(["a", "c", "b", "d"]); // روی آخرین ستون
    expect(BoardOrder.moveColumnKey(order, "d", "b")).toEqual(["a", "d", "b", "c"]); // روی ستون میانی
    // دکمه/تابع یک‌گامه‌ای وجود ندارد (تصمیم محصولی: فقط درگ‌انددراپ)
    expect("shiftColumnKey" in BoardOrder).toBe(false);
  });

  it("ادغام ترتیب ذخیره‌شده با ستون‌های واقعی: بدون تکرار و بدون از دست رفتن ستون", () => {
    const units = [{ key: "a" }, { key: "b" }, { key: "c" }];
    const merged = Columns.mergeColumnOrder(units, ["c", "ghost", "a", "c"]);
    expect(merged.map((u) => u.key)).toEqual(["c", "a", "b"]);
    expect(Columns.mergeColumnOrder(units, null).map((u) => u.key)).toEqual(["a", "b", "c"]);
    expect(Columns.mergeColumnOrder(units, []).map((u) => u.key)).toEqual(["a", "b", "c"]);
  });
});
