/**
 * توکن جلسه و SSO — امضا/اعتبارسنجی JWT با jose (HS256).
 * این ماژول خالص است (بدون next/headers) تا در تست و اسکریپت هم قابل استفاده باشد.
 */
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";

export interface SessionClaims extends JWTPayload {
  sub: string;
  sid: string;
  role: "staff" | "admin";
  name: string;
}

function sessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 16) {
    throw new AppError("INTERNAL", "SESSION_SECRET تنظیم نشده است (حداقل ۱۶ کاراکتر)");
  }
  return new TextEncoder().encode(secret);
}

export interface SignSessionInput {
  sub: string;
  role: "staff" | "admin";
  name: string;
  sid?: string;
}

export async function signSessionToken(claims: SignSessionInput, ttlHours = 12): Promise<string> {
  const sid = claims.sid ?? newId("sess");
  return new SignJWT({ role: claims.role, name: claims.name, sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlHours}h`)
    .sign(sessionSecret());
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.sid !== "string" || typeof payload.role !== "string" || typeof payload.name !== "string") {
      return null;
    }
    return payload as SessionClaims;
  } catch {
    return null;
  }
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/* ── SSO اختیاری ─────────────────────────────────────────────────── */

export interface SsoClaims extends JWTPayload {
  sub?: string;
  username?: string;
  role?: string;
  name?: string;
}

/**
 * اعتبارسنجی توکن SSO صادرشده توسط سرور اصلی (فقط اگر SSO_ENABLED=true).
 * اگر سرور شما JWT با راز مشترک HS256 صادر می‌کند، همین کافی است.
 */
export async function verifySsoToken(token: string): Promise<SsoClaims | null> {
  if (process.env.SSO_ENABLED !== "true") return null;
  const secret = process.env.SSO_JWT_SECRET;
  if (!secret) throw new AppError("INTERNAL", "SSO فعال است اما SSO_JWT_SECRET تنظیم نشده");
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      issuer: process.env.SSO_ISSUER || undefined,
      audience: process.env.SSO_AUDIENCE || undefined,
    });
    return payload as SsoClaims;
  } catch {
    return null;
  }
}
