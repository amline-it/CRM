/**
 * لایه دسترسی به SQLite داخلی Node (node:sqlite) — صفر وابستگی باینری.
 * همه کوئری‌ها پارامتری‌اند؛ حالت WAL برای خواندن/نوشتن هم‌زمان پنل.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

let db: DatabaseSync | null = null;

export function dbPath(): string {
  const configured = process.env.DATABASE_PATH ?? "data/crm.db";
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

export function getDb(): DatabaseSync {
  if (db) return db;
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA busy_timeout = 5000;");
  db = database;
  return database;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export type SqlValue = string | number | null | Uint8Array;

/**
 * ردیف‌های `node:sqlite` شیءهایی با پروتوتایپ null هستند و React/Next اجازه عبور
 * آن‌ها از مرز سرور→کلاینت را نمی‌دهد («Only plain objects … can be passed to
 * Client Components»). پس هر ردیف به شیء ساده کپی می‌شود تا در همه صفحات پنل
 * (کانبان، صندوق اعلان، پرونده) بی‌دردسر قابل ارسال باشد.
 */
function toPlain<T>(row: T): T {
  return { ...(row as Record<string, unknown>) } as T;
}

export function all<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): T[] {
  const stmt = getDb().prepare(sql);
  return (stmt.all(...params) as T[]).map(toPlain);
}

export function get<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): T | null {
  const stmt = getDb().prepare(sql);
  const row = stmt.get(...params);
  return row === undefined ? null : toPlain(row as T);
}

export function run(sql: string, params: SqlValue[] = []): { changes: number; lastInsertRowid: number } {
  const stmt = getDb().prepare(sql);
  const result = stmt.run(...params);
  return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
}

export function exec(sql: string): void {
  getDb().exec(sql);
}

/** تراکنش همگام (node:sqlite همگام است) — در صورت خطا rollback می‌شود */
export function transaction<T>(fn: () => T): T {
  const database = getDb();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* rollback در صورت خطای اتصال */
    }
    throw err;
  }
}

export function jsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
