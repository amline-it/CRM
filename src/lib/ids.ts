import { randomUUID, randomBytes } from "node:crypto";

export function newId(prefix?: string): string {
  const id = randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

/** شماره پرونده خوانا: CRM-1405-000123 */
export function buildCaseCode(sequence: number, jy: number): string {
  return `CRM-${jy}-${String(sequence).padStart(6, "0")}`;
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** کلید idempotency برای درخواست‌های تکراری */
export function idempotencyKey(parts: Array<string | number | undefined | null>): string {
  return parts.filter((p) => p !== undefined && p !== null && p !== "").join(":");
}

export function hashPayload(value: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}
