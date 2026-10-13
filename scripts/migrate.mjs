#!/usr/bin/env node
/**
 * اجرای مهاجرت‌های SQL روی دیتابیس SQLite (بدون وابستگی بیرونی).
 * استفاده: npm run migrate [-- --status]
 *
 * دستور `-- @foreign-keys-off` در ابتدای فایل مهاجرت یعنی آن مهاجرت جدول والد را
 * بازنویسی می‌کند: FK موقتاً خاموش، مهاجرت در تراکنش اتمیک، بررسی
 * `PRAGMA foreign_key_check` پیش از commit و روشن‌کردن دوباره FK در پایان.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const migrationsDir = process.env.MIGRATIONS_DIR ?? path.join(projectRoot, "migrations");
const dbPath = path.isAbsolute(process.env.DATABASE_PATH ?? "")
  ? process.env.DATABASE_PATH
  : path.join(projectRoot, process.env.DATABASE_PATH ?? "data/crm.db");

if (!fs.existsSync(migrationsDir)) {
  console.error(`[migrate] پوشه مهاجرت یافت نشد: ${migrationsDir}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");

const statusOnly = process.argv.includes("--status");
const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));
const files = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

if (statusOnly) {
  console.log(`[migrate] دیتابیس: ${dbPath}`);
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    console.log(`  ${applied.has(version) ? "✔ اعمال‌شده" : "• در انتظار"}  ${version}`);
  }
  db.close();
  process.exit(0);
}

let count = 0;
for (const file of files) {
  const version = file.replace(/\.sql$/, "");
  if (applied.has(version)) continue;
  const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  const foreignKeysOff = /^\s*--\s*@foreign-keys-off\s*$/m.test(sql);
  if (foreignKeysOff) db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(sql);
    if (foreignKeysOff) {
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length) {
        throw new Error(`نقض کلید خارجی پس از مهاجرت: ${JSON.stringify(violations.slice(0, 3))}`);
      }
    }
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
    db.exec("COMMIT");
    count += 1;
    console.log(`[migrate] اعمال شد: ${version}`);
  } catch (err) {
    db.exec("ROLLBACK");
    console.error(`[migrate] خطا در ${file}: ${err.message}`);
    db.close();
    process.exit(1);
  } finally {
    if (foreignKeysOff) db.exec("PRAGMA foreign_keys = ON");
  }
}

console.log(`[migrate] پایان — ${count} مهاجرت جدید روی ${dbPath}`);
db.close();
