#!/usr/bin/env node
/**
 * بارگذاری داده اولیه: مهاجرت‌ها + تعریف‌های گردش‌کار + خدمات پیش‌فرض (+ داده نمونه با --demo).
 * استفاده:
 *   npm run seed                 → تعریف‌ها و خدمات
 *   npm run seed -- --demo       → به‌همراه داده نمونه (کاربران، قرارداد، آگهی، نیازمندی، کارشناس نمونه)
 *   npm run seed -- --staff admin:Admin@1234:مدیر سامانه
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const projectRoot = process.cwd();
const migrationsDir = process.env.MIGRATIONS_DIR ?? path.join(projectRoot, "migrations");
const dbPath = path.isAbsolute(process.env.DATABASE_PATH ?? "")
  ? process.env.DATABASE_PATH
  : path.join(projectRoot, process.env.DATABASE_PATH ?? "data/crm.db");
const withDemo = process.argv.includes("--demo");
const staffArgIndex = process.argv.indexOf("--staff");

const nowIso = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
const hashPayload = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

/* ── ۱) مهاجرت ─────────────────────────────────────────────────────── */
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));
for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
  const version = file.replace(/\.sql$/, "");
  if (applied.has(version)) continue;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, nowIso());
    db.exec("COMMIT");
    console.log(`[seed] مهاجرت اعمال شد: ${version}`);
  } catch (err) {
    db.exec("ROLLBACK");
    console.error(`[seed] خطای مهاجرت ${file}: ${err.message}`);
    process.exit(1);
  }
}

/* ── ۲) تعریف‌های گردش‌کار ─────────────────────────────────────────── */
const definitionsDir = process.env.WORKFLOW_DEFINITIONS_DIR ?? path.join(projectRoot, "workflow-definitions");
let definitionCount = 0;
for (const file of fs.readdirSync(definitionsDir).filter((f) => /\.v\d+\.json$/.test(f)).sort()) {
  const definition = JSON.parse(fs.readFileSync(path.join(definitionsDir, file), "utf8"));
  const existing = db
    .prepare("SELECT id, active FROM workflow_definitions WHERE key = ? AND version = ?")
    .get(definition.key, definition.version);
  if (existing) {
    db.prepare("UPDATE workflow_definitions SET name = ?, definition = ? WHERE id = ?").run(
      definition.name,
      JSON.stringify(definition),
      existing.id,
    );
    if (!existing.active) {
      db.prepare("UPDATE workflow_definitions SET active = 0 WHERE key = ?").run(definition.key);
      db.prepare("UPDATE workflow_definitions SET active = 1, activated_at = ? WHERE id = ?").run(nowIso(), existing.id);
    }
  } else {
    db.prepare("UPDATE workflow_definitions SET active = 0 WHERE key = ?").run(definition.key);
    db.prepare(
      "INSERT INTO workflow_definitions (id, key, version, name, definition, active, created_at, activated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
    ).run(id("wfd"), definition.key, definition.version, definition.name, JSON.stringify(definition), nowIso(), nowIso());
  }
  definitionCount += 1;
  console.log(`[seed] گردش‌کار ثبت شد: ${definition.key}@v${definition.version} (${definition.states.length} حالت، ${definition.transitions.length} گذار)`);
}

/* ── ۳) خدمات پیش‌فرض ─────────────────────────────────────────────── */
const services = JSON.parse(fs.readFileSync(path.join(projectRoot, "src/data/default-services.json"), "utf8"));
let serviceCount = 0;
for (const service of services) {
  const existing = db.prepare("SELECT id FROM services WHERE key = ?").get(service.key);
  if (existing) continue;
  db.prepare(
    `INSERT INTO services (id, key, name, category, description, price, requires_subscription, requires_referral,
       workflow_key, required_documents, active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run(
    id("svc"),
    service.key,
    service.name,
    service.category,
    service.description ?? null,
    service.price ?? 0,
    service.requiresSubscription ? 1 : 0,
    service.requiresReferral ? 1 : 0,
    service.workflowKey,
    JSON.stringify(service.requiredDocuments ?? []),
    service.sortOrder ?? 0,
    nowIso(),
    nowIso(),
  );
  serviceCount += 1;
}
console.log(`[seed] خدمات ساخته‌شده: ${serviceCount} (از ${services.length})`);

/* ── ۳.۵) واحدهای سازمانی (ستون‌های کانبان ارجاع) ──────────────────── */
const ORG_UNITS = [
  { key: "reception", name: "واحد پذیرش", description: "دریافت و ثبت اولیه خدمات", sort_order: 1 },
  { key: "legal", name: "واحد حقوقی", description: "بررسی حقوقی و قراردادها", sort_order: 2 },
  { key: "finance", name: "واحد مالی", description: "پرداخت، فاکتور و تسویه", sort_order: 3 },
  { key: "registration", name: "واحد ثبت", description: "ثبت و تطبیق پرونده‌ها", sort_order: 4 },
  { key: "marketing", name: "واحد بازاریابی", description: "انتشار آگهی و معرفی", sort_order: 5 },
  { key: "sales", name: "واحد فروش", description: "پیگیری قراردادها و مشتریان", sort_order: 6 },
  { key: "management", name: "واحد مدیریت", description: "تأییدهای مدیریتی و تصمیم‌های کلان", sort_order: 7 },
  { key: "technical", name: "واحد فنی", description: "بررسی فنی ملک و کارشناسی", sort_order: 8 },
];
let orgUnitCount = 0;
for (const unit of ORG_UNITS) {
  const existing = db.prepare("SELECT id FROM org_units WHERE key = ?").get(unit.key);
  if (existing) continue;
  db.prepare(
    "INSERT INTO org_units (id, key, name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id("org"), unit.key, unit.name, unit.description ?? null, unit.sort_order ?? 0, nowIso(), nowIso());
  orgUnitCount += 1;
}
if (orgUnitCount) console.log(`[seed] واحدهای سازمانی ساخته شد: ${orgUnitCount}`);

/* ── ۴) کارشناس نمونه (اختیاری) ───────────────────────────────────── */
if (staffArgIndex !== -1) {
  const spec = process.argv[staffArgIndex + 1] ?? "admin:Admin@1234:مدیر سامانه";
  const [username, password, fullName] = spec.split(":");
  if (!username || !password) {
    console.error("[seed] قالب نامعتبر. نمونه: --staff admin:Admin@1234:مدیر سامانه");
    process.exit(1);
  }
  const existing = db.prepare("SELECT id FROM staff WHERE username = ?").get(username);
  if (existing) {
    console.log(`[seed] کارشناس ${username} از قبل وجود دارد`);
  } else {
    db.prepare(
      "INSERT INTO staff (id, username, password_hash, full_name, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)",
    ).run(id("stf"), username, legacyHash(password), fullName ?? username, nowIso(), nowIso());
    console.log(`[seed] کارشناس مدیر ساخته شد: ${username} (رمز: ${password})`);
  }
}

/* ── ۵) داده نمونه (اختیاری) ──────────────────────────────────────── */
if (withDemo) {
  const hasUsers = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (hasUsers > 0) {
    console.log("[seed] داده نمونه از قبل وجود دارد؛ رد شد");
  } else {
    seedDemo();
    console.log("[seed] داده نمونه ساخته شد");
  }
}

console.log(`[seed] پایان — دیتابیس: ${dbPath} (تعریف‌ها: ${definitionCount})`);
db.close();

/* ── توابع کمکی ───────────────────────────────────────────────────── */

function seedDemo() {
  const insertUser = db.prepare(
    `INSERT INTO users (id, external_id, source, full_name, national_id, mobile, email, user_type, agent_license_no, city, status, deleted, payload_hash, raw, synced_at, created_at, updated_at)
     VALUES (?, ?, 'main-server', ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?)`,
  );
  const insertCase = db.prepare(
    `INSERT INTO cases (id, code, external_id, source, title, service_key, workflow_key, workflow_version, state, status, priority,
       owner_user_id, agent_user_id, assigned_staff_id, due_at, requires_tracking, access_level, attempts_payment, attempts_tracking, meta,
       opened_at, last_transition_at, created_at, updated_at)
     VALUES (?, ?, ?, 'main-server', ?, ?, ?, 1, ?, 'open', ?, ?, ?, NULL, NULL, ?, ?, 0, 0, '{}', ?, ?, ?, ?)`,
  );
  const insertTimeline = db.prepare(
    `INSERT INTO timeline_events (id, case_id, kind, title, body, visibility, actor_id, actor_name, at, meta)
     VALUES (?, ?, 'case.created', ?, ?, 'internal', NULL, 'سینک سرور اصلی', ?, '{}')`,
  );
  const insertContract = db.prepare(
    `INSERT INTO contract_details (id, case_id, contract_type, output_mode, property_address, city, district, area, landlord_name, tenant_name,
       seller_name, buyer_name, deposit_amount, rent_amount, sale_price, start_date, end_date, terms_note, clause_version, created_at, updated_at)
     VALUES (?, ?, ?, 'signature_only', ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, NULL, 1, ?, ?)`,
  );
  const insertListing = db.prepare(
    `INSERT INTO listings (id, case_id, external_id, source, owner_user_id, agent_user_id, deal_type, property_type, city, district, address, area, rooms,
       year_built, price, deposit, rent, description, amenities, images, status, published_at, expires_at, views, created_at, updated_at)
     VALUES (?, ?, NULL, 'main-server', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?, ?, ?)`,
  );
  const insertRequirement = db.prepare(
    `INSERT INTO requirements (id, case_id, external_id, source, requester_user_id, deal_type, property_type, city, districts, budget_min, budget_max,
       area_min, area_max, rooms, description, access_level, status, expires_at, created_at, updated_at)
     VALUES (?, ?, NULL, 'main-server', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const staff = db.prepare("SELECT id, full_name FROM staff WHERE active = 1 ORDER BY created_at LIMIT 1").get();
  const staffId = staff?.id ?? null;
  const staffName = staff?.full_name ?? "کارشناس";

  const users = [
    { name: "مریم احمدی", mobile: "09121234567", city: "تهران", type: "normal" },
    { name: "علی رضایی", mobile: "09129876543", city: "تهران", type: "normal" },
    { name: "حسین کریمی", mobile: "09121112233", city: "کرج", type: "agent", license: "AG-4521" },
    { name: "زهرا موسوی", mobile: "09123334455", city: "تهران", type: "normal" },
    { name: "سعید نوری", mobile: "09135556677", city: "اصفهان", type: "agent", license: "AG-7788" },
    { name: "فاطمه شریفی", mobile: "09137778899", city: "تهران", type: "normal" },
  ];
  const userIds = [];
  for (const user of users) {
    const userId = id("usr");
    userIds.push(userId);
    insertUser.run(
      userId,
      `ext-${userIds.length}`,
      user.name,
      null,
      user.mobile,
      null,
      user.type,
      user.license ?? null,
      user.city,
      hashPayload(user),
      JSON.stringify(user),
      nowIso(),
      nowIso(),
      nowIso(),
    );
  }

  const contracts = [
    {
      title: "قرارداد اجاره آپارتمان — سعادت‌آباد",
      type: "rent",
      address: "تهران، سعادت‌آباد، خیابان علامه شمالی، پلاک ۱۲، واحد ۴",
      city: "تهران",
      district: "سعادت‌آباد",
      area: 96,
      rooms: 2,
      landlord: "مریم احمدی",
      tenant: "علی رضایی",
      deposit: 300000000,
      rent: 25000000,
      start: "1405/07/01",
      end: "1406/06/31",
      owner: 0,
      state: "finance_check",
    },
    {
      title: "قرارداد خرید و فروش — جردن",
      type: "sale",
      address: "تهران، جردن، خیابان ناهید، پلاک ۸، واحد ۲",
      city: "تهران",
      district: "جردن",
      area: 120,
      rooms: 3,
      landlord: "زهرا موسوی",
      tenant: "فاطمه شریفی",
      deposit: null,
      rent: null,
      start: "1405/07/10",
      end: null,
      owner: 3,
      state: "documents_review",
    },
  ];
  const contractIds = [];
  for (const contract of contracts) {
    const caseId = id("case");
    contractIds.push(caseId);
    const code = `CRM-C-${1405000 + contractIds.length}`;
    insertCase.run(
      caseId,
      code,
      `ext-contract-${contractIds.length}`,
      contract.title,
      contract.type === "rent" ? "contract_rent" : "contract_sale",
      "contract",
      contract.state,
      contract.type === "sale" ? "high" : "normal",
      userIds[contract.owner],
      null,
      0,
      contract.type === "rent" ? "agents" : "staff",
      nowIso(),
      nowIso(),
      nowIso(),
      nowIso(),
    );
    insertContract.run(
      id("ctr"),
      caseId,
      contract.type,
      contract.address,
      contract.city,
      contract.district,
      contract.area,
      contract.landlord,
      contract.tenant,
      contract.deposit,
      contract.rent,
      contract.start,
      contract.end,
      nowIso(),
      nowIso(),
    );
    insertTimeline.run(id("tl"), caseId, "پرونده سینک شد", "این پرونده از سرور اصلی دریافت شده است.", nowIso());
    db.prepare(
      `INSERT INTO documents (id, case_id, kind, title, status, note, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', NULL, 1, ?, ?)`,
    ).run(id("doc"), caseId, "national_landlord", "کارت ملی مالک", nowIso(), nowIso());
  }

  const listings = [
    {
      deal: "rent",
      type: "آپارتمان",
      city: "تهران",
      district: "سعادت‌آباد",
      address: "سعادت‌آباد، علامه شمالی، پلاک ۲۴",
      area: 88,
      rooms: 2,
      deposit: 200000000,
      rent: 22000000,
      status: "pending_review",
      owner: 2,
    },
    {
      deal: "sale",
      type: "آپارتمان",
      city: "تهران",
      district: "جردن",
      address: "جردن، ناهید، پلاک ۵",
      area: 118,
      rooms: 3,
      price: 95000000000,
      status: "published",
      owner: 1,
    },
    {
      deal: "rent",
      type: "ویلا",
      city: "کرج",
      district: "مهرشهر",
      address: "مهرشهر، بلوار ارم، پلاک ۳",
      area: 240,
      rooms: 4,
      deposit: 500000000,
      rent: 45000000,
      status: "published",
      owner: 2,
    },
  ];
  for (const listing of listings) {
    const caseId = id("case");
    const code = `CRM-L-${1405100 + listings.indexOf(listing)}`;
    insertCase.run(
      caseId,
      code,
      `ext-listing-${listings.indexOf(listing)}`,
      `آگهی ${listing.type} ${listing.district}`,
      "listing_publish",
      "listing",
      listing.status === "published" ? "listing_published" : "listing_review",
      "normal",
      userIds[listing.owner],
      null,
      0,
      null,
      nowIso(),
      nowIso(),
      nowIso(),
      nowIso(),
    );
    insertListing.run(
      id("lst"),
      caseId,
      userIds[listing.owner],
      listing.deal,
      listing.type,
      listing.city,
      listing.district,
      listing.address,
      listing.area,
      listing.rooms,
      listing.deal === "sale" ? 1398 : 1390,
      listing.price ?? null,
      listing.deposit ?? null,
      listing.rent ?? null,
      `${listing.type} ${listing.area} متری در ${listing.district}`,
      listing.status,
      listing.status === "published" ? nowIso() : null,
      new Date(Date.now() + 30 * 86400000).toISOString(),
      Math.floor(Math.random() * 120),
      nowIso(),
      nowIso(),
    );
    insertTimeline.run(id("tl"), caseId, "پرونده سینک شد", "این پرونده از سرور اصلی دریافت شده است.", nowIso());
  }

  const requirements = [
    {
      deal: "rent",
      type: "آپارتمان",
      city: "تهران",
      districts: ["سعادت‌آباد", "جردن"],
      budgetMin: 150000000,
      budgetMax: 300000000,
      areaMin: 70,
      areaMax: 110,
      rooms: 2,
      access: "public",
      status: "open",
      requester: 0,
    },
    {
      deal: "sale",
      type: "آپارتمان",
      city: "تهران",
      districts: ["جردن", "پاسداران"],
      budgetMin: 80000000000,
      budgetMax: 110000000000,
      areaMin: 100,
      areaMax: 140,
      rooms: 3,
      access: "agents",
      status: "matched",
      requester: 3,
    },
  ];
  for (const requirement of requirements) {
    const caseId = id("case");
    const code = `CRM-R-${1405200 + requirements.indexOf(requirement)}`;
    insertCase.run(
      caseId,
      code,
      `ext-requirement-${requirements.indexOf(requirement)}`,
      `نیازمندی ${requirement.type} ${requirement.city}`,
      "requirement_register",
      "requirements",
      requirement.status === "open" ? "requirements_visible" : "requirements_matched",
      "normal",
      userIds[requirement.requester],
      null,
      0,
      requirement.access,
      nowIso(),
      nowIso(),
      nowIso(),
      nowIso(),
    );
    insertRequirement.run(
      id("req"),
      caseId,
      userIds[requirement.requester],
      requirement.deal,
      requirement.type,
      requirement.city,
      JSON.stringify(requirement.districts),
      requirement.budgetMin,
      requirement.budgetMax,
      requirement.areaMin,
      requirement.areaMax,
      requirement.rooms,
      `نیازمندی نمونه برای ${requirement.city}`,
      requirement.access,
      requirement.status,
      new Date(Date.now() + 14 * 86400000).toISOString(),
      nowIso(),
      nowIso(),
    );
    insertTimeline.run(id("tl"), caseId, "پرونده سینک شد", "این پرونده از سرور اصلی دریافت شده است.", nowIso());
  }

  if (staffId) {
    db.prepare(
      `INSERT INTO tasks (id, case_id, title, description, priority, assignee_id, due_at, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    ).run(
      id("tsk"),
      contractIds[0],
      "پیگیری مدارک مالک",
      "کارت ملی مالک و سند مالکیت باید بارگذاری و بررسی شود.",
      "high",
      staffId,
      new Date(Date.now() + 2 * 86400000).toISOString(),
      staffId,
      nowIso(),
      nowIso(),
    );
    console.log(`[seed] وظیفه نمونه برای ${staffName} ساخته شد`);
  }

  seedKanbanDemo();
}

/* ── داده نمونه کانبان ارجاع (واحدها، کارشناسان و پرونده‌های ارجاعی) ── */
function seedKanbanDemo() {
  const staffSpec = [
    { u: "reception1", n: "کارشناس پذیرش", unit: "reception", title: "کارشناس پذیرش" },
    { u: "legal1", n: "کارشناس حقوقی", unit: "legal", title: "کارشناس حقوقی" },
    { u: "finance1", n: "کارشناس مالی", unit: "finance", title: "کارشناس مالی" },
    { u: "reg1", n: "کارشناس ثبت", unit: "registration", title: "کارشناس ثبت" },
    { u: "mkt1", n: "کارشناس بازاریابی", unit: "marketing", title: "کارشناس بازاریابی" },
    { u: "sales1", n: "کارشناس فروش", unit: "sales", title: "کارشناس فروش" },
    { u: "mgr1", n: "مدیر عملیات", unit: "management", title: "مدیر عملیات" },
    { u: "tech1", n: "کارشناس فنی", unit: "technical", title: "کارشناس فنی" },
  ];
  const staffIds = {};
  const unitToStaff = {};
  for (const s of staffSpec) {
    let row = db.prepare("SELECT id FROM staff WHERE username = ?").get(s.u);
    if (!row) {
      const sid = id("stf");
      db.prepare(
        "INSERT INTO staff (id, username, password_hash, full_name, role, active, org_unit, title, created_at, updated_at) VALUES (?, ?, ?, ?, 'staff', 1, ?, ?, ?, ?)",
      ).run(sid, s.u, legacyHash("Demo@1234"), s.n, s.unit, s.title, nowIso(), nowIso());
      row = { id: sid };
    }
    staffIds[s.u] = row.id;
    unitToStaff[s.unit] = row.id;
  }

  // نقشه شناسه → نام کامل (برای متن منشن) و مدیر سامانه (گیرنده نمونه اعلان)
  const staffById = new Map(
    db.prepare("SELECT id, full_name FROM staff WHERE active = 1").all().map((row) => [row.id, row.full_name]),
  );
  const adminStaffId = db.prepare("SELECT id FROM staff WHERE role = 'admin' AND active = 1 ORDER BY created_at LIMIT 1").get()?.id ?? null;

  const insertCase = db.prepare(
    `INSERT INTO cases (id, code, external_id, source, title, service_key, workflow_key, workflow_version, state, status, priority,
       owner_user_id, agent_user_id, assigned_staff_id, due_at, requires_tracking, access_level, attempts_payment, attempts_tracking, meta,
       opened_at, last_transition_at, created_at, updated_at, kanban_status)
     VALUES (?, NULL, NULL, 'kanban-demo', ?, 'custom', 'custom_service', 1, 'service_start', 'open', 'normal',
       NULL, NULL, ?, NULL, 0, NULL, 0, 0, '{}', ?, ?, ?, ?, ?)`,
  );
  const insertRef = db.prepare(
    `INSERT INTO referrals (id, case_id, entity_type, from_staff_id, from_unit, to_staff_id, to_unit, kind, reason,
       description, expected_output, priority, due_at, status_before, status_after, actor_type, actor_id, actor_name,
       service_key, service_name, depth, at, created_at, updated_at)
     VALUES (?, ?, 'case', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff', ?, ?, 'custom', ?, ?, ?, ?, ?)`,
  );
  const insertMessage = db.prepare(
    `INSERT INTO case_messages (id, case_id, author_staff_id, author_name, body, created_at, meta)
     VALUES (?, ?, ?, ?, ?, ?, '{}')`,
  );
  const insertMention = db.prepare(
    `INSERT INTO case_message_mentions (id, message_id, case_id, mentioned_staff_id, notified, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`,
  );
  const insertInbox = db.prepare(
    `INSERT INTO notifications (id, channel, template, to_user_id, to_address, to_staff_id, case_id, body, status, kind, link, read_at, dedupe_key, sent_at, created_at)
     VALUES (?, 'inapp', ?, NULL, NULL, ?, ?, ?, 'sent', ?, ?, NULL, ?, ?, ?)`,
  );
  const insertTimeline = db.prepare(
    `INSERT INTO timeline_events (id, case_id, kind, title, body, visibility, actor_id, actor_name, at, meta)
     VALUES (?, ?, 'referral.sent', ?, ?, 'internal', ?, 'کانبان', ?, '{}')`,
  );

  const samples = [
    {
      title: "قرارداد اجاره واحد ۱۲",
      hops: [{ fromUnit: "reception", toUnit: "legal", toStaff: "legal1", kind: "unit", reason: "بررسی حقوقی قرارداد", status: "in_review", dueDays: 2 }],
    },
    {
      title: "آگهی فروش ویلای شمال",
      hops: [{ fromUnit: "reception", toUnit: "marketing", toStaff: null, kind: "unit", reason: "انتشار در پایگاه آگهی", status: "waiting_info", dueDays: 5 }],
    },
    {
      title: "استعلام سند ملک کلاردشت",
      hops: [{ fromUnit: "reception", toUnit: "legal", toStaff: "legal1", kind: "unit", reason: "استعلام سند و بازبینی مدارک", status: "in_review", dueDays: -1 }],
    },
    {
      title: "درخواست تطبیق نیازمندی",
      hops: [
        { fromUnit: "reception", toUnit: "registration", toStaff: "reg1", kind: "unit", reason: "ثبت درخواست", status: "new" },
        { fromUnit: "registration", toUnit: "finance", toStaff: "finance1", kind: "unit", reason: "بررسی پرداخت و تسویه", status: "in_review" },
      ],
    },
  ];

  for (const sample of samples) {
    const caseId = id("case");
    const lastHop = sample.hops[sample.hops.length - 1];
    const assignedId = lastHop.toStaff ? staffIds[lastHop.toStaff] : null;
    insertCase.run(caseId, sample.title, assignedId, nowIso(), nowIso(), nowIso(), nowIso(), lastHop.status);
    let depth = 0;
    let lastDueAt = null;
    let lastPriority = "normal";
    for (const hop of sample.hops) {
      depth += 1;
      const fromStaffId = unitToStaff[hop.fromUnit] ?? null;
      const toStaffId = hop.toStaff ? staffIds[hop.toStaff] : null;
      const dueDays = Number.isFinite(hop.dueDays) ? hop.dueDays : depth === 1 ? 2 : 5;
      const dueAt = new Date(Date.now() + dueDays * 86400000).toISOString();
      lastDueAt = dueAt;
      lastPriority = hop.priority ?? "normal";
      const isLastHop = hop === sample.hops[sample.hops.length - 1];
      // وضعیت «پس از ارجاع» همیشه «ارجاع‌شده» است؛ وضعیت جاری کارت روی آخرین گام ثبت می‌شود
      const statusAfter = isLastHop ? hop.status : "new";
      const refId = id("ref");
      insertRef.run(
        refId,
        caseId,
        fromStaffId,
        hop.fromUnit,
        toStaffId,
        hop.toUnit,
        hop.kind ?? "unit",
        hop.reason,
        hop.description ?? "شرح کار در نمونه دمو",
        hop.expectedOutput ?? "نتیجه بررسی و ثبت در پرونده",
        hop.priority ?? "normal",
        dueAt,
        hop.statusBefore ?? "new",
        statusAfter,
        fromStaffId,
        unitToStaff[hop.fromUnit] ? staffLabel(hop.fromUnit) : "کانبان",
        sample.title,
        depth,
        nowIso(),
        nowIso(),
        nowIso(),
      );
      insertTimeline.run(id("tle"), caseId, `ارجاع به واحد ${hop.toUnit}`, hop.reason, fromStaffId, nowIso());
    }
    // مثل سرویس واقعی ارجاع: مهلت و اولویت عملیات روی خود پرونده هم به‌روزرسانی می‌شود
    db.prepare("UPDATE cases SET due_at = ?, priority = ? WHERE id = ?").run(lastDueAt, lastPriority, caseId);

    // گفت‌وگوی داخلی نمونه + منشن همکار (بدون انتقال مسئولیت)
    const authorUnit = sample.hops[0].fromUnit;
    const authorId = unitToStaff[authorUnit] ?? null;
    const lastHopRef = sample.hops[sample.hops.length - 1];
    const secondUnit = lastHopRef.toUnit;
    const mentionedId = unitToStaff[secondUnit] ?? null;
    const messageId = id("msg");
    const messageAt = nowIso();
    // هدف‌های منشن: کارمند واحد مقصد + مدیر سامانه (منشن مسئولیت را منتقل نمی‌کند)
    const mentionTargets = [];
    if (mentionedId && mentionedId !== authorId) mentionTargets.push(mentionedId);
    if (adminStaffId && adminStaffId !== authorId && adminStaffId !== mentionedId) mentionTargets.push(adminStaffId);
    const mentionText = mentionTargets.map((sid) => `@${staffById.get(sid) ?? ""}`).filter((t) => t !== "@").join(" و ");
    insertMessage.run(
      messageId,
      caseId,
      authorId,
      authorId ? staffLabel(authorUnit) : "کانبان",
      `پرونده «${sample.title}» ثبت شد. ${mentionText ? `${mentionText} ` : ""}لطفاً بررسی کنید و نتیجه را در همین گفت‌وگو ثبت کنید.`,
      messageAt,
    );
    for (const targetId of mentionTargets) {
      insertMention.run(id("men"), messageId, caseId, targetId, messageAt);
      insertInbox.run(
        id("ntf"),
        "mention",
        targetId,
        caseId,
        `شما در گفت‌وگوی پرونده «${sample.title}» منشن شدید`,
        "mention",
        `/panel/cases/${caseId}#conversation`,
        `ops:demo:mention:${messageId}:${targetId}`,
        messageAt,
        messageAt,
      );
    }
    const ownerId = assignedId ?? mentionedId;
    if (ownerId) {
      insertInbox.run(
        id("ntf"),
        lastHopRef.toStaff ? "referral.new" : "referral.queue",
        ownerId,
        caseId,
        lastHopRef.toStaff
          ? `ارجاع تازه: عملیات پرونده «${sample.title}» به شما سپرده شد`
          : `عملیات پرونده «${sample.title}» در صف واحد شما قرار گرفت`,
        lastHopRef.toStaff ? "referral.new" : "referral.queue",
        `/panel/cases/${caseId}#ops-quick-actions`,
        `ops:demo:referral:${caseId}:${ownerId}`,
        nowIso(),
        nowIso(),
      );
    }
  }
  console.log("[seed] کانبان عملیات: کارشناسان، پرونده‌های ارجاعی، گفت‌وگو و اعلان‌های نمونه ساخته شد");
}

/** برچسب فارسی واحد برای متن نمونه */
function staffLabel(unitKey) {
  const found = ORG_UNITS.find((unit) => unit.key === unitKey);
  return found ? found.name : unitKey;
}

/** hash سازگار با scrypt در src/auth/password.ts (فرمت scrypt$N$r$p$salt$hash) */
function legacyHash(password) {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, { N, r, p, maxmem: 128 * N * r * 2 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}
