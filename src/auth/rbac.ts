/**
 * کنترل دسترسی نقش‌محور (RBAC) — پنل فقط برای کارشناس و مدیر است.
 */
import { AppError } from "@/lib/errors";

export type Role = "staff" | "admin";

export type Permission =
  | "case.view"
  | "case.create"
  | "case.transition"
  | "case.abort"
  | "case.assign"
  | "case.close"
  | "document.review"
  | "legal.review"
  | "payment.record"
  | "payment.abort"
  | "tracking.manage"
  | "tracking.abort"
  | "listing.manage"
  | "requirement.manage"
  | "user.view"
  | "task.manage"
  | "referral.manage"
  | "service.manage"
  | "workflow.manage"
  | "staff.manage"
  | "settings.manage"
  | "sync.manage"
  | "report.view"
  | "audit.view";

const STAFF_PERMISSIONS: Permission[] = [
  "case.view",
  "case.create",
  "case.transition",
  "case.assign",
  "document.review",
  "payment.record",
  "tracking.manage",
  "listing.manage",
  "requirement.manage",
  "user.view",
  "task.manage",
  "report.view",
];

const ADMIN_ONLY: Permission[] = [
  "case.abort",
  "case.close",
  "legal.review",
  "payment.abort",
  "tracking.abort",
  "referral.manage",
  "service.manage",
  "workflow.manage",
  "staff.manage",
  "settings.manage",
  "sync.manage",
  "audit.view",
];

const MATRIX: Record<Role, Permission[]> = {
  staff: STAFF_PERMISSIONS,
  admin: [...STAFF_PERMISSIONS, ...ADMIN_ONLY],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false;
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw new AppError("FORBIDDEN", "شما به این عملیات دسترسی ندارید");
  }
}

export function permissionsOf(role: Role): Permission[] {
  return [...(MATRIX[role] ?? [])];
}
