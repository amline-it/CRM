#!/usr/bin/env node
/**
 * تولید مجموعه دیاگرام‌های Mermaid پروژه.
 *
 * دیاگرام‌های «داده‌محور» مستقیماً از منبع حقیقت ساخته می‌شوند تا همیشه با کد هم‌خوان بمانند:
 *   - migrations/0001_init.sql        → ERD (نمای کلی + کامل)
 *   - src/**                          → گراف وابستگی ماژول‌ها (از import های واقعی)
 *   - workflow-definitions/*.json     → دیاگرام حالت هر گردش‌کار + نگاشت گاردها/افکت‌ها
 *   - src/domain/guards|effects       → کلیدهای ثبت‌شده در رجیستری
 *
 * استفاده:
 *   node --no-warnings scripts/generate-diagrams.mjs            # تولید همه + docs/diagrams/README.md
 *   node --no-warnings scripts/generate-diagrams.mjs --check    # فقط بررسی هم‌خوانی (بدون نوشتن)
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "docs", "diagrams");
const checkOnly = process.argv.includes("--check");

/* ── فهرست دیاگرام‌ها (ترتیب = ترتیب نمایش در README و مرورگر دیاگرام‌ها) ── */

const MANIFEST = [
  {
    file: "01-architecture.mmd",
    title: "معماری کلی سامانه",
    kind: "دستی",
    desc: "لایه‌ها (وب، سرویس، دامنه خالص، داده)، ورودی‌های بیرونی (کارمند، سرور اصلی، cron) و وابستگی بین آن‌ها.",
  },
  {
    file: "02-module-graph.mmd",
    title: "گراف وابستگی ماژول‌ها",
    kind: "تولیدی",
    desc: "یال‌ها از import های واقعی `@/…` در `src/**` استخراج می‌شوند؛ جهت وابستگی لایه‌ها را نشان می‌دهد.",
  },
  {
    file: "03-erd-overview.mmd",
    title: "نمودار موجودیت-رابطه (نمای کلی)",
    kind: "تولیدی",
    desc: "۳۱ جدول دیتابیس و رابطه‌های آن‌ها بدون جزئیات ستون‌ها — برای دیدن شکل کلی داده.",
  },
  {
    file: "04-erd-full.mmd",
    title: "نمودار موجودیت-رابطه (کامل)",
    kind: "تولیدی",
    desc: "همه ستون‌ها با نوع و نشانگر PK/FK/UK به‌همراه رابطه‌های صریح (REFERENCES) و منطقی (بدون FK).",
  },
  {
    file: "05-transition-lifecycle.mmd",
    title: "چرخه عمر یک گذار",
    kind: "دستی",
    desc: "از کلیک کارشناس در پنل تا CSRF/RBAC، engine.plan، تراکنش دیتابیس، اعلان‌ها و صف وب‌هوک.",
  },
  {
    file: "06-engine-plan.mmd",
    title: "درون موتور گردش‌کار",
    kind: "دستی",
    desc: "منطق `Engine.plan`: اعتبارسنجی، گاردها، گزینه‌ها، زنجیره گذارهای خودکار (سقف ۲۵ گام + تشخیص حلقه) و حالت پایانی.",
  },
  {
    file: "07-workflow-contract.mmd",
    title: "گردش‌کار قرارداد (contract v1)",
    kind: "تولیدی",
    desc: "۳۳ حالت و ۴۱ گذار: انتخاب خدمت → اطلاعات قرارداد → مالی → مدارک → حقوقی → امضا → کد رهگیری → بستن پرونده.",
  },
  {
    file: "08-workflow-listing.mmd",
    title: "گردش‌کار آگهی (listing v1)",
    kind: "تولیدی",
    desc: "بررسی مالی آگهی → تکمیل اطلاعات → بررسی کارشناس → انتشار/توقف/انقضا/بستن.",
  },
  {
    file: "09-workflow-requirements.mmd",
    title: "گردش‌کار نیازمندی‌ها (requirements v1)",
    kind: "تولیدی",
    desc: "ثبت نیازمندی → سطح دسترسی → تطبیق با آگهی‌ها → برآورده‌شدن یا انقضا.",
  },
  {
    file: "10-workflow-custom-service.mmd",
    title: "گردش‌کار سایر خدمات (custom_service v1)",
    kind: "تولیدی",
    desc: "قالب عمومی خدمت سفارشی: ثبت → بررسی مالی → بررسی کارشناس → بستن پرونده.",
  },
  {
    file: "11-guards-effects-map.mmd",
    title: "نگاشت گاردها و افکت‌ها",
    kind: "تولیدی",
    desc: "کدام گارد/افکت در کدام گردش‌کار استفاده شده و کدام کلیدهای رجیستری هنوز مصرف‌کننده ندارند.",
  },
  {
    file: "12-sync-push.mmd",
    title: "سینک Push (اینگست)",
    kind: "دستی",
    desc: "مسیر `POST /api/v1/ingest/[entity]`: احراز هویت دوگانه (کلید + HMAC)، idempotency و پردازش آیتم‌به‌آیتم.",
  },
  {
    file: "13-sync-pull-webhook.mmd",
    title: "سینک Pull و Webhook خروجی",
    kind: "دستی",
    desc: "کارهای زمان‌بندی‌شده: واکشی با کرسور از سرور اصلی و ارسال وب‌هوک با backoff نمایی (سقف ۵ تلاش).",
  },
  {
    file: "14-auth-session.mmd",
    title: "احراز هویت، نشست و RBAC",
    kind: "دستی",
    desc: "ورود (scrypt/SSO)، کوکی HttpOnly، مسیر بدون کوکی با `X-Session-Ticket`، CSRF بدون‌حالت و ماتریس دسترسی.",
  },
  {
    file: "15-panel-sitemap.mmd",
    title: "نقشه پنل و API",
    kind: "دستی",
    desc: "صفحات `/panel/**` در سه گروه کارتابل/پرونده‌ها/مدیریت، Server Actionهای هر صفحه و endpoint های HTTP.",
  },
  {
    file: "16-deployment.mmd",
    title: "استقرار با داکر",
    kind: "دستی",
    desc: "ایمیج چندمرحله‌ای، والیوم `crm-data` (SQLite)، معکوس‌پروکسی، crontab و متغیرهای محیطی حساس.",
  },
];

/* ── ابزارها ─────────────────────────────────────────────────────── */

/** پاک‌سازی متن برای استفاده امن در برچسب Mermaid */
function label(text) {
  return String(text ?? "")
    .replace(/"/g, "'")
    .replace(/[:#;]/g, "،")
    .replace(/\s+/g, " ")
    .trim();
}

function write(file, content) {
  const target = path.join(outDir, file);
  const before = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (before === content) return { file, changed: false };
  if (checkOnly) return { file, changed: true };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return { file, changed: true };
}

const results = [];

/* ── ۱) پارس اسکیمای SQL ─────────────────────────────────────────── */

function parseSchema() {
  const sql = fs.readFileSync(path.join(root, "migrations", "0001_init.sql"), "utf8");
  const tables = [];
  for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const [, name, bodyRaw] = match;
    const columns = [];
    const tableUniques = [];
    for (const rawLine of bodyRaw.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("--")) continue;
      if (/^(PRIMARY KEY|CHECK|FOREIGN KEY)\b/i.test(line)) continue;
      const uniqueMatch = line.match(/^UNIQUE\s*\(([^)]+)\)/i);
      if (uniqueMatch) {
        tableUniques.push(uniqueMatch[1].split(",").map((c) => c.trim()));
        continue;
      }
      const col = line.match(/^(\w+)\s+([A-Za-z]+(?:\s*\(\s*[\d,\s]+\))?)((?:\s+(?:PRIMARY KEY|NOT NULL|UNIQUE|DEFAULT[^,]*|REFERENCES[^,]*|CHECK.*))*)/i);
      if (!col) continue;
      const [, colName, type, restRaw] = col;
      let rest = restRaw ?? "";
      // DEFAULT ممکن است کاما داشته باشد؛ بخش REFERENCES را دقیق جدا می‌کنیم
      const refMatch = rest.match(/REFERENCES\s+(\w+)\s*\((\w+)\)(\s+ON DELETE\s+(CASCADE|SET NULL|NO ACTION|RESTRICT))?/i);
      columns.push({
        name: colName,
        type: type.replace(/\s*\(\s*[\d,\s]+\)/, "").toUpperCase(),
        pk: /PRIMARY KEY/i.test(rest),
        notNull: /NOT NULL/i.test(rest),
        unique: /UNIQUE/i.test(rest),
        fk: refMatch ? { table: refMatch[1], column: refMatch[2], onDelete: (refMatch[4] ?? "").toUpperCase() } : null,
      });
    }
    for (const combo of tableUniques) {
      if (combo.length === 1) {
        const target = columns.find((c) => c.name === combo[0]);
        if (target) target.unique = true;
      }
    }
    tables.push({ name, columns, tableUniques });
  }
  return tables;
}

/** رابطه‌های منطقی که در SQL با REFERENCES اعلام نشده‌اند اما در کد رعایت می‌شوند */
const LOGICAL_RELATIONS = [
  ["cases", "service_key", "services", "خدمت (service_key)"],
  ["cases", "workflow_key", "workflow_definitions", "گردش‌کار (workflow_key)"],
  ["cases", "owner_user_id", "users", "مالک پرونده"],
  ["cases", "agent_user_id", "users", "کارگزار"],
  ["cases", "assigned_staff_id", "staff", "کارشناس مسئول"],
  ["tasks", "assignee_id", "staff", "انجام‌دهنده وظیفه"],
  ["tasks", "created_by", "staff", "سازنده وظیفه"],
  ["documents", "reviewed_by", "staff", "بررسی‌کننده مدرک"],
  ["legal_reviews", "reviewer_id", "staff", "بررسی‌کننده حقوقی"],
  ["timeline_events", "actor_id", "staff", "کنشگر رویداد"],
  ["subscriptions", "user_id", "users", "اشتراک کاربر"],
  ["referral_codes", "owner_user_id", "users", "صاحب کد"],
  ["referral_uses", "approved_by", "staff", "تأییدکننده مصرف"],
  ["listings", "owner_user_id", "users", "مالک آگهی"],
  ["listings", "agent_user_id", "users", "کارگزار آگهی"],
  ["requirements", "requester_user_id", "users", "درخواست‌کننده نیازمندی"],
  ["requirement_matches", "listing_id", "listings", "آگهی تطبیق‌شده"],
  ["notifications", "to_user_id", "users", "گیرنده پیام"],
  ["notifications", "case_id", "cases", "پرونده مرتبط"],
  ["outbound_webhooks", "case_id", "cases", "پرونده مرتبط"],
];

/** برچسب فارسی ستون‌های پرکاربرد (برای ERD کامل) */
const COLUMN_COMMENTS = {
  id: "شناسه یکتا",
  key: "کلید",
  code: "کد",
  name: "نام",
  title: "عنوان",
  status: "وضعیت",
  state: "حالت گردش‌کار",
  outcome: "نتیجه پرونده",
  priority: "اولویت",
  source: "منبع داده",
  external_id: "شناسه در سرور اصلی",
  case_id: "پرونده",
  staff_id: "کارمند",
  user_id: "کاربر",
  created_at: "زمان ایجاد",
  updated_at: "زمان به‌روزرسانی",
  at: "زمان رویداد",
  amount: "مبلغ",
  price: "قیمت",
  method: "روش",
  note: "یادداشت",
  payload: "بار JSON",
  attempt: "شماره تلاش",
  attempts: "شمار تلاش‌ها",
  active: "فعال است",
  deleted: "حذف‌شده",
  version: "نسخه",
  definition: "JSON تعریف",
  role: "نقش",
  username: "نام کاربری",
  password_hash: "هش رمز (scrypt)",
  full_name: "نام کامل",
  mobile: "موبایل",
  email: "رایانامه",
  city: "شهر",
  district: "محله",
  area: "متراژ",
  address: "نشانی",
  expires_at: "انقضا",
  due_at: "سررسید",
  queue: "صف کاری",
  channel: "کانال",
  template: "قالب پیام",
  event: "رویداد",
  target_url: "آدرس مقصد",
  attempts_tracking: "تلاش‌های کد رهگیری",
  attempts_payment: "تلاش‌های پرداخت",
  requires_tracking: "نیاز به کد رهگیری",
  workflow_key: "کلید گردش‌کار",
  workflow_version: "نسخه قفل‌شده گردش‌کار",
  service_key: "کلید خدمت",
  contract_type: "نوع قرارداد (rent/sale)",
  output_mode: "خروجی موردنیاز",
  clause_version: "نسخه بندها",
  idempotency_key: "کلید یکتاسازی",
  token_hash: "هش توکن نشست",
  revoked_at: "زمان ابطال",
  score: "امتیاز تطبیق",
  access_level: "سطح دسترسی",
  deal_type: "نوع معامله",
  property_type: "نوع ملک",
  last_pulled_at: "آخرین واکشی",
  direction: "جهت سینک",
  entity_type: "نوع موجودیت",
};

const FK_LABELS = {
  case_id: "پرونده",
  staff_id: "کارمند",
  invoice_id: "فاکتور",
  code_id: "کد ریفرال",
  requirement_id: "نیازمندی",
  sync_log_id: "لاگ سینک",
};

function relationLabel(columnName, fk) {
  if (FK_LABELS[columnName]) return FK_LABELS[columnName];
  return `${columnName} → ${fk.table}.${fk.column}`;
}

/**
 * کاردینالیتی از دید «والد → فرزند»:
 *   FK اجباری + یکتا  → یک‌به‌یک  (||--||)
 *   FK اجباری         → یک‌به‌چند (||--o{)
 *   FK اختیاری + یکتا → یک‌به‌یک اختیاری (|o--o|)
 *   FK اختیاری        → یک‌به‌چند اختیاری (|o--o{)
 */
function cardinality(column) {
  const left = column.notNull ? "||" : "|o";
  const right = column.unique ? (column.notNull ? "||" : "o|") : "o{";
  return `${left}--${right}`;
}

function buildRelations(tables) {
  const relations = [];
  for (const table of tables) {
    for (const column of table.columns) {
      if (!column.fk) continue;
      relations.push({
        parent: column.fk.table.toUpperCase(),
        child: table.name.toUpperCase(),
        card: cardinality(column),
        text: relationLabel(column.name, column.fk),
        logical: false,
        onDelete: column.fk.onDelete,
      });
    }
  }
  const byName = new Map(tables.map((t) => [t.name, t]));
  for (const [child, column, parent, text] of LOGICAL_RELATIONS) {
    const childTable = byName.get(child);
    if (!childTable || !byName.has(parent)) continue;
    const childColumn = childTable.columns.find((c) => c.name === column);
    relations.push({
      parent: parent.toUpperCase(),
      child: child.toUpperCase(),
      card: childColumn?.notNull ? "||--o{" : "|o--o{",
      text: `${text} — منطقی`,
      logical: true,
    });
  }
  return relations;
}

function renderErd(tables, { withColumns }) {
  const lines = [];
  lines.push("---");
  lines.push(
    withColumns
      ? "title: ERD کامل — ۳۱ جدول SQLite (تولیدشده از migrations/0001_init.sql)"
      : "title: ERD نمای کلی — رابطه‌های ۳۱ جدول (تولیدشده از migrations/0001_init.sql)",
  );
  lines.push("---");
  lines.push("erDiagram");

  const relations = buildRelations(tables);
  for (const rel of relations) {
    lines.push(`  ${rel.parent} ${rel.card} ${rel.child} : "${label(rel.text)}"`);
  }
  lines.push("");

  for (const table of tables) {
    if (!withColumns) continue;
    lines.push(`  ${table.name.toUpperCase()} {`);
    for (const column of table.columns) {
      const marks = [];
      if (column.pk) marks.push("PK");
      if (column.fk) marks.push("FK");
      if (column.unique && !column.pk) marks.push("UK");
      const comment = COLUMN_COMMENTS[column.name];
      const markText = marks.length ? ` ${marks.join(", ")}` : "";
      lines.push(`    ${column.type.toLowerCase()} ${column.name}${markText}${comment ? ` "${label(comment)}"` : ""}`);
    }
    lines.push("  }");
  }
  return `${lines.join("\n")}\n`;
}

const schemaTables = parseSchema();
results.push(write("03-erd-overview.mmd", renderErd(schemaTables, { withColumns: false })));
results.push(write("04-erd-full.mmd", renderErd(schemaTables, { withColumns: true })));

/* ── ۲) گراف وابستگی ماژول‌ها از import های واقعی ─────────────────── */

function moduleGroup(file) {
  const rel = file.replace(/^src[\\/]/, "").split(path.sep).join("/");
  const parts = rel.split("/");
  if (parts[0] === "app") {
    if (parts[1] === "api") return "app/api";
    if (parts[1] === "panel") return "app/panel";
    if (parts[1] === "login") return "app/login";
    if (parts[1] === "logout") return "app/logout";
    return "app/root";
  }
  if (parts[0] === "db") return parts[1] === "repos" ? "db/repos" : "db/core";
  if (parts[0] === "domain") return `domain/${parts[1]}`;
  if (parts[0] === "services") return `services/${parts[2] ?? parts[1]}`.replace(/\.ts$/, "");
  if (parts[0] === "auth") return "auth";
  if (parts[0] === "components") return "components";
  if (parts[0] === "lib") return "lib";
  if (parts[0] === "data") return "data";
  return parts[0];
}

function targetGroup(spec) {
  const t = spec.replace(/^@\//, "");
  if (t.startsWith("app/")) return moduleGroup(`src/${t}`);
  if (t.startsWith("db/repos")) return "db/repos";
  if (t.startsWith("db/")) return "db/core";
  if (t.startsWith("domain/engine")) return "domain/engine";
  if (t.startsWith("domain/")) return `domain/${t.split("/")[1]}`;
  if (t.startsWith("services/")) return `services/${t.split("/")[1].replace(/\.ts$/, "")}`;
  if (t.startsWith("auth/")) return "auth";
  if (t.startsWith("components/")) return "components";
  if (t.startsWith("lib/")) return "lib";
  if (t.startsWith("data/")) return "data";
  return t.split("/")[0];
}

function collectSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function renderModuleGraph() {
  const files = collectSourceFiles(path.join(root, "src"));
  const edges = new Map();
  const fileCount = new Map();
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const from = moduleGroup(rel);
    fileCount.set(from, (fileCount.get(from) ?? 0) + 1);
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/from\s+"(@\/[^"]+)"/g)) {
      const to = targetGroup(match[1]);
      if (to === from) continue;
      const key = `${from}->${to}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }

  const LAYERS = [
    { key: "web", title: "لایه وب — src/app", groups: ["app/root", "app/login", "app/logout", "app/panel", "app/api"] },
    { key: "client", title: "کلاینت مشترک", groups: ["components"] },
    { key: "security", title: "احراز هویت — src/auth", groups: ["auth"] },
    { key: "app", title: "لایه سرویس — src/services", groups: ["services/sync", "services/definitions"] },
    {
      key: "domain",
      title: "دامنه — src/domain",
      groups: ["domain/service", "domain/workflows", "domain/engine", "domain/guards", "domain/effects", "domain/adapters"],
    },
    { key: "data", title: "داده — src/db", groups: ["db/repos", "db/core"] },
    { key: "shared", title: "مشترک", groups: ["lib", "data"] },
  ];

  const NODE_NAMES = {
    "app/root": "app — layout و صفحه ریشه",
    "app/login": "app/login — ورود",
    "app/logout": "app/logout — خروج",
    "app/panel": "app/panel — پنل کارکنان",
    "app/api": "app/api — health و v1",
    components: "components/session-bridge",
    auth: "auth — session/jwt/csrf/rbac/password/ticket",
    "services/sync": "services/sync.ts",
    "services/definitions": "services/definitions.ts",
    "domain/service": "domain/service — CaseService",
    "domain/workflows": "domain/workflows — buildEngine",
    "domain/engine": "domain/engine — plan/available/validate",
    "domain/guards": "domain/guards",
    "domain/effects": "domain/effects",
    "domain/adapters": "domain/adapters — پرداخت/رهگیری/اعلان",
    "db/repos": "db/repos — cases/catalog/finance/people/platform",
    "db/core": "db/core — client/migrate",
    lib: "lib — errors/ids/jalali/money/fa-labels",
    data: "data — default-services.json",
  };

  const id = (g) => `M_${g.replace(/[/.]/g, "_")}`;
  const lines = [];
  lines.push("---");
  lines.push("title: گراف وابستگی ماژول‌ها — استخراج‌شده از import های واقعی src/**");
  lines.push("---");
  lines.push("flowchart LR");
  lines.push("  classDef web fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a;");
  lines.push("  classDef app fill:#ede9fe,stroke:#6d28d9,color:#4c1d95;");
  lines.push("  classDef dom fill:#dcfce7,stroke:#15803d,color:#14532d;");
  lines.push("  classDef data fill:#fef3c7,stroke:#b45309,color:#78350f;");
  lines.push("  classDef sec fill:#fce7f3,stroke:#be185d,color:#831843;");
  const CLASS = {
    web: ["app/root", "app/login", "app/logout", "app/panel", "app/api", "components"],
    sec: ["auth"],
    app: ["services/sync", "services/definitions"],
    dom: ["domain/service", "domain/workflows", "domain/engine", "domain/guards", "domain/effects", "domain/adapters"],
    data: ["db/repos", "db/core", "lib", "data"],
  };
  const classOf = (g) => Object.entries(CLASS).find(([, list]) => list.includes(g))?.[0] ?? "data";

  for (const layer of LAYERS) {
    const present = layer.groups.filter((g) => fileCount.has(g));
    if (!present.length) continue;
    lines.push("");
    lines.push(`  subgraph SG_${layer.key}["${layer.title}"]`);
    lines.push("    direction TB");
    for (const g of present) {
      lines.push(`    ${id(g)}["${NODE_NAMES[g] ?? g}<br/><small>${fileCount.get(g)} فایل</small>"]:::${classOf(g)}`);
    }
    lines.push("  end");
  }

  lines.push("");
  const sorted = [...edges.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [key, count] of sorted) {
    const [from, to] = key.split("->");
    if (!fileCount.has(from) || !fileCount.has(to)) continue;
    const arrow = count >= 6 ? "==>" : "-->";
    lines.push(`  ${id(from)} ${arrow}|${count}| ${id(to)}`);
  }
  return `${lines.join("\n")}\n`;
}

results.push(write("02-module-graph.mmd", renderModuleGraph()));

/* ── ۳) دیاگرام حالت گردش‌کارها از workflow-definitions/*.json ───── */

const STATE_MARKER = {
  start: " ⟦آغاز⟧",
  decision: " ⟦تصمیم⟧",
  error: " ⟦خطا/حلقه⟧",
  terminal: " ⟦پایانی⟧",
  process: "",
};

function renderWorkflow(def) {
  const lines = [];
  lines.push("---");
  lines.push(`title: ${def.name} (${def.key} v${def.version}) — ${def.states.length} حالت و ${def.transitions.length} گذار`);
  lines.push("---");
  lines.push("stateDiagram-v2");
  lines.push("  direction TB");

  for (const state of def.states) {
    const marker = state.terminal ? STATE_MARKER.terminal : (STATE_MARKER[state.type] ?? "");
    lines.push(`  state "${label(state.name)}${marker}<br/>${state.key}" as ${state.key}`);
  }
  lines.push("");
  lines.push(`  [*] --> ${def.initial}`);

  const terminalStates = def.states.filter((s) => s.terminal || s.type === "terminal").map((s) => s.key);
  for (const key of terminalStates) lines.push(`  ${key} --> [*]`);
  lines.push("");

  const seen = new Set();
  const emit = (from, to, text) => {
    const dedupe = `${from}|${to}|${text}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    lines.push(`  ${from} --> ${to} : ${text}`);
  };

  for (const tr of def.transitions) {
    const froms = Array.isArray(tr.from) ? tr.from : [tr.from];
    const kindTag = tr.kind === "auto" ? " ⟦خودکار⟧" : tr.kind === "choice" ? " ⟦انتخابی⟧" : "";
    if (tr.kind === "choice" && Array.isArray(tr.options)) {
      for (const option of tr.options) {
        for (const from of froms) emit(from, option.to, `${label(tr.name)} ▸ ${label(option.label)}${kindTag}`);
      }
      continue;
    }
    if (!tr.to) continue;
    for (const from of froms) emit(from, tr.to, `${label(tr.name)}${kindTag}`);
  }

  lines.push("");
  lines.push(`  note right of ${def.initial}`);
  lines.push(`    منبع حقیقت: workflow-definitions/${def.key}.v${def.version}.json`);
  lines.push("    نسخه‌ای که پرونده با آن ساخته می‌شود قفل می‌گردد");
  lines.push("  end note");
  return `${lines.join("\n")}\n`;
}

const defsDir = path.join(root, "workflow-definitions");
const definitions = fs
  .readdirSync(defsDir)
  .filter((f) => /\.v\d+\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(defsDir, f), "utf8")));

const WORKFLOW_FILES = {
  contract: "07-workflow-contract.mmd",
  listing: "08-workflow-listing.mmd",
  requirements: "09-workflow-requirements.mmd",
  custom_service: "10-workflow-custom-service.mmd",
};

for (const def of definitions) {
  const target = WORKFLOW_FILES[def.key];
  if (!target) {
    console.warn(`[diagrams] گردش‌کار «${def.key}» در فهرست نیست — نادیده گرفته شد`);
    continue;
  }
  results.push(write(target, renderWorkflow(def)));
}

/* ── ۴) نگاشت گاردها و افکت‌ها ───────────────────────────────────── */

function registryKeys(file, exportName) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const block = source.match(new RegExp(`export const ${exportName}[\\s\\S]*?\\n};`));
  if (!block) return [];
  return [...block[0].matchAll(/^\s{2}([a-z_0-9]+):/gm)].map((m) => m[1]);
}

/** کلیدهای مصرف‌شده در یک تعریف؛ `withOnTerminal` فقط برای افکت‌ها صادق است */
function usedKeys(def, pick, { withOnTerminal = false } = {}) {
  const keys = new Set();
  for (const tr of def.transitions) {
    for (const item of pick(tr)) keys.add(item.key);
    for (const option of tr.options ?? []) for (const item of pick(option)) keys.add(item.key);
  }
  if (withOnTerminal) for (const item of def.crm?.onTerminal ?? []) keys.add(item.key);
  return [...keys];
}

function renderGuardsEffects() {
  const guardKeys = registryKeys("src/domain/guards/index.ts", "guards");
  const effectKeys = registryKeys("src/domain/effects/index.ts", "effects");
  const usedGuards = new Set();
  const usedEffects = new Set();

  const lines = [];
  lines.push("---");
  lines.push("title: نگاشت گاردها و افکت‌ها — کدام کلید در کدام گردش‌کار مصرف می‌شود");
  lines.push("---");
  lines.push("mindmap");
  lines.push(`  root((رجیستری دامنه<br/>${guardKeys.length} گارد<br/>${effectKeys.length} افکت))`);

  for (const def of definitions) {
    const guards = usedKeys(def, (x) => x.guards ?? []);
    const effects = usedKeys(def, (x) => x.effects ?? [], { withOnTerminal: true });
    guards.forEach((g) => usedGuards.add(g));
    effects.forEach((e) => usedEffects.add(e));
    lines.push(`    ${def.name} — ${def.key} v${def.version}`);
    lines.push("      گاردها");
    for (const g of guards.sort()) lines.push(`        ${g}`);
    lines.push("      افکت‌ها");
    for (const e of effects.sort()) lines.push(`        ${e}`);
  }

  const unusedGuards = guardKeys.filter((k) => !usedGuards.has(k));
  const unusedEffects = effectKeys.filter((k) => !usedEffects.has(k));
  const unknownGuards = [...usedGuards].filter((k) => !guardKeys.includes(k));
  const unknownEffects = [...usedEffects].filter((k) => !effectKeys.includes(k));

  lines.push("    وضعیت رجیستری");
  lines.push(`      گاردهای بدون مصرف (${unusedGuards.length})`);
  for (const g of unusedGuards.sort()) lines.push(`        ${g}`);
  lines.push(`      افکت‌های بدون مصرف (${unusedEffects.length})`);
  for (const e of unusedEffects.sort()) lines.push(`        ${e}`);
  lines.push(`      کلیدهای ناشناس در تعریف‌ها (${unknownGuards.length + unknownEffects.length})`);
  for (const k of [...unknownGuards, ...unknownEffects].sort()) lines.push(`        ${k}`);

  return `${lines.join("\n")}\n`;
}

results.push(write("11-guards-effects-map.mmd", renderGuardsEffects()));

/* ── ۵) ساخت README.md (نمایه + درج همه دیاگرام‌ها برای رندر در گیت‌هاب) ── */

function stripFrontMatter(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n/, "");
}

function renderReadme() {
  const generated = new Set(MANIFEST.filter((m) => m.kind === "تولیدی").map((m) => m.file));
  const lines = [];
  lines.push("# دیاگرام‌های CRM املاک (Mermaid)");
  lines.push("");
  lines.push("همه دیاگرام‌های پروژه در این پوشه به دو شکل در دسترس‌اند:");
  lines.push("");
  lines.push("* فایل خام `*.mmd` — برای Mermaid Live Editor، ابزارها و CI");
  lines.push("* همین صفحه — GitHub بلوک‌های `mermaid` را داخل Markdown به‌صورت تصویر رندر می‌کند");
  lines.push("");
  lines.push("## ابزارها");
  lines.push("");
  lines.push("| دستور | کار |");
  lines.push("| --- | --- |");
  lines.push("| `npm run diagrams` | بازتولید دیاگرام‌های داده‌محور + همین نمایه |");
  lines.push("| `npm run diagrams:check` | بررسی هم‌خوانی دیاگرام‌های تولیدی با کد (بدون نوشتن) |");
  lines.push("| `npm run diagrams:view` | مرورگر محلی دیاگرام‌ها با قابلیت بزرگ‌نمایی و خروجی SVG/PNG |");
  lines.push("| `npm run flowchart` | فلوچارت کامل گردش‌کارها (نسخه flowchart، در `docs/superpowers/specs/`) |");
  lines.push("");
  lines.push("دیاگرام‌های **تولیدی** از منبع حقیقت ساخته می‌شوند و نباید دستی ویرایش شوند:");
  lines.push("");
  lines.push("| دیاگرام | منبع |");
  lines.push("| --- | --- |");
  lines.push("| `02-module-graph.mmd` | `import` های واقعی در `src/**` |");
  lines.push("| `03-erd-overview.mmd` و `04-erd-full.mmd` | `migrations/0001_init.sql` |");
  lines.push("| `07` تا `10` (گردش‌کارها) | `workflow-definitions/*.json` |");
  lines.push("| `11-guards-effects-map.mmd` | `src/domain/guards` + `src/domain/effects` + تعریف‌ها |");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## فهرست دیاگرام‌ها");
  lines.push("");

  MANIFEST.forEach((item, index) => {
    const anchor = item.file.replace(/\.mmd$/, "");
    lines.push(`${index + 1}. [${item.title}](#${anchor}) — ${item.kind === "تولیدی" ? "تولیدی" : "دستی"}`);
  });

  for (const item of MANIFEST) {
    const full = path.join(outDir, item.file);
    const body = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`## ${item.file.replace(/\.mmd$/, "")}`);
    lines.push("");
    lines.push(`### ${item.title}`);
    lines.push("");
    lines.push(item.desc);
    lines.push("");
    lines.push(`* فایل: [\`${item.file}\`](./${item.file}) — ${item.kind === "تولیدی" ? "تولید خودکار از کد (`npm run diagrams`)" : "نگهداری دستی"}`);
    lines.push("");
    lines.push("```mermaid");
    lines.push(stripFrontMatter(body).trimEnd());
    lines.push("```");
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## نکته‌ها");
  lines.push("");
  lines.push("* اگر دیاگرام تولیدی با کد هم‌خوان نباشد، `npm run diagrams:check` در CI شکست می‌خورد.");
  lines.push("* برای ویرایش گردش‌کارها فقط `workflow-definitions/*.json` را تغییر دهید (یا از پنل «گردش‌کارها» نسخه تازه وارد کنید) و سپس `npm run diagrams` را اجرا کنید.");
  lines.push("* فلوچارت تودرتو و کامل همه گردش‌کارها در `docs/superpowers/specs/2026-10-13-crm-flowchart.mmd` قرار دارد (`npm run flowchart`).");
  lines.push("");
  return lines.join("\n");
}

const readme = renderReadme();
const readmePath = path.join(outDir, "README.md");
const readmeBefore = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : null;
if (readmeBefore !== readme) {
  if (!checkOnly) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(readmePath, readme, "utf8");
  }
  results.push({ file: "README.md", changed: true });
} else {
  results.push({ file: "README.md", changed: false });
}

/* ── گزارش ───────────────────────────────────────────────────────── */

const changed = results.filter((r) => r.changed);
if (checkOnly) {
  if (changed.length) {
    console.error(`[diagrams] ${changed.length} فایل با کد هم‌خوان نیست — «npm run diagrams» را اجرا کنید:`);
    for (const item of changed) console.error(`  - docs/diagrams/${item.file}`);
    process.exit(1);
  }
  console.log("[diagrams] همه دیاگرام‌ها با کد هم‌خوان‌اند.");
} else {
  console.log(`[diagrams] ${results.length} فایل بررسی شد؛ ${changed.length} مورد نوشته/به‌روز شد:`);
  for (const item of changed) console.log(`  ✓ docs/diagrams/${item.file}`);
  for (const item of results.filter((r) => !r.changed)) console.log(`  = docs/diagrams/${item.file} (بدون تغییر)`);
}
