/**
 * هش رمز عبور با scrypt داخلی Node — بدون وابستگی بیرونی.
 * قالب ذخیره: scrypt$N$r$p$salt$hash  (salt و hash به‌صورت base64url)
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function hashPassword(plain: string): string {
  if (typeof plain !== "string" || plain.length < 6) {
    throw new Error("رمز عبور باید حداقل ۶ کاراکتر باشد");
  }
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(plain, salt, KEY_LEN, { N, r: R, p: P });
  return ["scrypt", N, R, P, b64url(salt), b64url(hash)].join("$");
}

export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!plain || !stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltStr, hashStr] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashStr, "base64url");
  } catch {
    return false;
  }
  const actual = scryptSync(plain, Buffer.from(saltStr, "base64url"), expected.length, { N: n, r, p });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
