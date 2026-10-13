/**
 * اجرای مهاجرت‌های SQL — idempotent و ترتیبی.
 * مسیر پیش‌فرض: <project>/migrations (قابل تغییر با MIGRATIONS_DIR).
 *
 * دستور خاص در فایل مهاجرت: `-- @foreign-keys-off`
 *   برای مهاجرت‌هایی که باید جدول والد (مثل `cases`) را بازنویسی کنند. در این حالت
 *   مهاجرت با `PRAGMA foreign_keys=OFF` (بیرون از تراکنش، چون SQLite داخل تراکنش
 *   این PRAGMA را نادیده می‌گیرد) اجرا می‌شود، همچنان در یک تراکنش اتمیک می‌ماند و
 *   پیش از commit با `PRAGMA foreign_key_check` سلامت ارجاع‌ها بررسی می‌شود؛
 *   در صورت وجود نقض یا هر خطا، rollback کامل انجام و FK دوباره روشن می‌شود.
 */
import fs from "node:fs";
import path from "node:path";
import { exec, get, run, all } from "./client";

export function migrationsDir(): string {
  return process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), "migrations");
}

/** آیا مهاجرت خواسته FK موقتاً خاموش شود؟ */
export function migrationNeedsForeignKeysOff(sql: string): boolean {
  return /^\s*--\s*@foreign-keys-off\s*$/m.test(sql);
}

let migrated = false;

export function ensureMigrated(force = false): string[] {
  if (migrated && !force) return [];
  const dir = migrationsDir();
  if (!fs.existsSync(dir)) {
    throw new Error(`پوشه مهاجرت یافت نشد: ${dir}`);
  }
  exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);
  const applied = new Set(all<{ version: string }>("SELECT version FROM schema_migrations").map((r) => r.version));
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const foreignKeysOff = migrationNeedsForeignKeysOff(sql);
    // PRAGMA داخل تراکنش بی‌اثر است؛ پس بیرون از تراکنش تنظیم و در پایان بازگردانده می‌شود
    if (foreignKeysOff) exec("PRAGMA foreign_keys = OFF");
    exec("BEGIN IMMEDIATE");
    try {
      exec(sql);
      if (foreignKeysOff) {
        const violations = all<Record<string, unknown>>("PRAGMA foreign_key_check");
        if (violations.length) {
          throw new Error(`نقض کلید خارجی پس از مهاجرت: ${JSON.stringify(violations.slice(0, 3))}`);
        }
      }
      run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [version, new Date().toISOString()]);
      exec("COMMIT");
    } catch (err) {
      try {
        exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw new Error(`اجرای مهاجرت ${file} شکست خورد: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (foreignKeysOff) exec("PRAGMA foreign_keys = ON");
    }
    ran.push(version);
  }
  migrated = true;
  return ran;
}

export function migrationStatus(): Array<{ version: string; applied_at: string }> {
  return all<{ version: string; applied_at: string }>("SELECT version, applied_at FROM schema_migrations ORDER BY version");
}

export function isMigrated(): boolean {
  try {
    const row = get<{ n: number }>("SELECT COUNT(*) AS n FROM schema_migrations");
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
