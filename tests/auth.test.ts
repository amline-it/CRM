/**
 * تست‌های احراز هویت: هش رمز، توکن جلسه، RBAC و توکن CSRF.
 */
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/auth/password";
import { can, permissionsOf, assertCan } from "@/auth/rbac";
import { signSessionToken, verifySessionToken, tokenHash } from "@/auth/jwt";
import { createCsrfToken, safeEqual } from "@/auth/csrf";

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
});
