/**
 * تست‌های احراز هویت: هش رمز، توکن جلسه، RBAC و توکن CSRF.
 */
import { afterEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/auth/password";
import { can, permissionsOf, assertCan } from "@/auth/rbac";
import { signSessionToken, verifySessionToken, tokenHash } from "@/auth/jwt";
import { createCsrfToken, safeEqual, verifyCsrfToken } from "@/auth/csrf";
import { headerSessionEnabled, ticketFromHeaders } from "@/auth/ticket";
import { demoModeEnabled } from "@/auth/demo";

process.env.SESSION_SECRET = "test-secret-at-least-32-chars-long!!";

describe("رمز عبور", () => {
  it("هش scrypt ساخته و درست بررسی می‌شود", () => {
    const stored = hashPassword("Ramz-1234");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("Ramz-1234", stored)).toBe(true);
    expect(verifyPassword("ramz-1234", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
    expect(verifyPassword("Ramz-1234", "invalid")).toBe(false);
  });

  it("دو هش از یک رمز، متفاوت‌اند (salt تصادفی)", () => {
    expect(hashPassword("SamePass1")).not.toBe(hashPassword("SamePass1"));
  });

  it("رمز کوتاه رد می‌شود", () => {
    expect(() => hashPassword("123")).toThrowError(/۶/);
  });
});

describe("توکن جلسه", () => {
  it("توکن امضا و اعتبارسنجی می‌شود", async () => {
    const token = await signSessionToken({ sub: "stf-1", role: "admin", name: "مدیر" });
    const claims = await verifySessionToken(token);
    expect(claims?.sub).toBe("stf-1");
    expect(claims?.role).toBe("admin");
    expect(claims?.sid).toBeTruthy();
  });

  it("توکن دست‌کاری‌شده رد می‌شود", async () => {
    const token = await signSessionToken({ sub: "stf-1", role: "staff", name: "کارشناس" });
    expect(await verifySessionToken(`${token}x`)).toBeNull();
    expect(await verifySessionToken("not-a-token")).toBeNull();
  });

  it("هش توکن پایدار است", async () => {
    const token = await signSessionToken({ sub: "s1", role: "staff", name: "ک" });
    expect(tokenHash(token)).toBe(tokenHash(token));
    expect(tokenHash(token)).toHaveLength(64);
  });
});

describe("RBAC", () => {
  it("کارشناس فقط مجوزهای عملیاتی دارد", () => {
    expect(can("staff", "case.transition")).toBe(true);
    expect(can("staff", "document.review")).toBe(true);
    expect(can("staff", "case.abort")).toBe(false);
    expect(can("staff", "staff.manage")).toBe(false);
    expect(can("staff", "workflow.manage")).toBe(false);
  });

  it("مدیر همه مجوزها را دارد", () => {
    for (const p of permissionsOf("staff")) expect(can("admin", p)).toBe(true);
    expect(can("admin", "staff.manage")).toBe(true);
    expect(can("admin", "sync.manage")).toBe(true);
  });

  it("assertCan در نبود مجوز خطای ۴۰۳ می‌دهد", () => {
    expect(() => assertCan("staff", "settings.manage")).toThrowError(/دسترسی/);
    expect(() => assertCan("admin", "settings.manage")).not.toThrow();
  });
});

describe("CSRF", () => {
  it("توکن تصادفی و مقایسه امن", () => {
    const a = createCsrfToken();
    const b = createCsrfToken();
    expect(a).not.toBe(b);
    expect(safeEqual(a, a)).toBe(true);
    expect(safeEqual(a, b)).toBe(false);
    expect(safeEqual(a, null)).toBe(false);
    expect(safeEqual("", "")).toBe(false);
  });

  it("توکن امضاشده معتبر است و به کوکی نیاز ندارد", () => {
    const token = createCsrfToken();
    const result = verifyCsrfToken(token);
    expect(result.ok).toBe(true);
    expect(token.split(".")).toHaveLength(3);
  });

  it("توکن دست‌کاری‌شده رد می‌شود", () => {
    const token = createCsrfToken();
    const [nonce, issuedAt] = token.split(".");
    const forged = `${nonce}.${issuedAt}.${Buffer.from("forged").toString("base64url")}`;
    expect(verifyCsrfToken(forged).ok).toBe(false);
    expect(verifyCsrfToken(forged).reason).toBe("bad_signature");
    // تغییر زمان انتشار هم امضا را باطل می‌کند
    const shifted = `${nonce}.${Number(issuedAt) + 1000}.${token.split(".")[2]}`;
    expect(verifyCsrfToken(shifted).ok).toBe(false);
  });

  it("توکن منقضی، خالی و بدساختار رد می‌شوند", () => {
    const old = createCsrfToken(Date.now() - 48 * 60 * 60 * 1000);
    expect(verifyCsrfToken(old)).toEqual({ ok: false, reason: "expired" });
    expect(verifyCsrfToken("")).toEqual({ ok: false, reason: "missing" });
    expect(verifyCsrfToken(null)).toEqual({ ok: false, reason: "missing" });
    expect(verifyCsrfToken("a.b")).toEqual({ ok: false, reason: "malformed" });
    expect(verifyCsrfToken("a.b.c.d")).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("توکن نشست از هدر (مسیر بدون کوکی)", () => {
  const fakeHeaders = (map: Record<string, string>) => ({
    get: (name: string) => map[name.toLowerCase()] ?? null,
  });

  it("هدر اختصاصی مقدم بر Authorization است", () => {
    expect(ticketFromHeaders(fakeHeaders({ "x-session-ticket": "abc" }))).toBe("abc");
    expect(ticketFromHeaders(fakeHeaders({ authorization: "Bearer xyz" }))).toBe("xyz");
    expect(ticketFromHeaders(fakeHeaders({ "x-session-ticket": "abc", authorization: "Bearer xyz" }))).toBe("abc");
  });

  it("هدرهای نامعتبر/خالی توکن نمی‌دهند", () => {
    expect(ticketFromHeaders(fakeHeaders({}))).toBeNull();
    expect(ticketFromHeaders(fakeHeaders({ "x-session-ticket": "   " }))).toBeNull();
    expect(ticketFromHeaders(fakeHeaders({ authorization: "Basic abc" }))).toBeNull();
    expect(ticketFromHeaders(fakeHeaders({ authorization: "Bearer " }))).toBeNull();
    expect(ticketFromHeaders(fakeHeaders({ authorization: "bearer low" }))).toBe("low");
  });

  it("با ALLOW_HEADER_SESSION=false این مسیر خاموش می‌شود", () => {
    const previous = process.env.ALLOW_HEADER_SESSION;
    process.env.ALLOW_HEADER_SESSION = "false";
    expect(headerSessionEnabled()).toBe(false);
    process.env.ALLOW_HEADER_SESSION = "true";
    expect(headerSessionEnabled()).toBe(true);
    if (previous === undefined) delete process.env.ALLOW_HEADER_SESSION;
    else process.env.ALLOW_HEADER_SESSION = previous;
  });
});

describe("حالت نمایش محلی (LOCAL_DEMO_MODE)", () => {
  const original = process.env.LOCAL_DEMO_MODE;

  afterEach(() => {
    if (original === undefined) delete process.env.LOCAL_DEMO_MODE;
    else process.env.LOCAL_DEMO_MODE = original;
  });

  it("پیش‌فرض خاموش است", () => {
    delete process.env.LOCAL_DEMO_MODE;
    expect(demoModeEnabled()).toBe(false);
  });

  it("فقط مقدار دقیق true آن را روشن می‌کند", () => {
    process.env.LOCAL_DEMO_MODE = "true";
    expect(demoModeEnabled()).toBe(true);
    process.env.LOCAL_DEMO_MODE = "TRUE";
    expect(demoModeEnabled()).toBe(true);
    process.env.LOCAL_DEMO_MODE = "1";
    expect(demoModeEnabled()).toBe(false);
    process.env.LOCAL_DEMO_MODE = "yes";
    expect(demoModeEnabled()).toBe(false);
    process.env.LOCAL_DEMO_MODE = "false";
    expect(demoModeEnabled()).toBe(false);
    process.env.LOCAL_DEMO_MODE = "";
    expect(demoModeEnabled()).toBe(false);
  });
});
