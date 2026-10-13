# دیاگرام‌های CRM املاک (Mermaid)

همه دیاگرام‌های پروژه در این پوشه به دو شکل در دسترس‌اند:

* فایل خام `*.mmd` — برای Mermaid Live Editor، ابزارها و CI
* همین صفحه — GitHub بلوک‌های `mermaid` را داخل Markdown به‌صورت تصویر رندر می‌کند

## ابزارها

| دستور | کار |
| --- | --- |
| `npm run diagrams` | بازتولید دیاگرام‌های داده‌محور + همین نمایه |
| `npm run diagrams:check` | بررسی هم‌خوانی دیاگرام‌های تولیدی با کد (بدون نوشتن) |
| `npm run diagrams:view` | مرورگر محلی دیاگرام‌ها با قابلیت بزرگ‌نمایی و خروجی SVG/PNG |
| `npm run flowchart` | فلوچارت کامل گردش‌کارها (نسخه flowchart، در `docs/superpowers/specs/`) |

دیاگرام‌های **تولیدی** از منبع حقیقت ساخته می‌شوند و نباید دستی ویرایش شوند:

| دیاگرام | منبع |
| --- | --- |
| `02-module-graph.mmd` | `import` های واقعی در `src/**` |
| `03-erd-overview.mmd` و `04-erd-full.mmd` | `migrations/0001_init.sql` |
| `07` تا `10` (گردش‌کارها) | `workflow-definitions/*.json` |
| `11-guards-effects-map.mmd` | `src/domain/guards` + `src/domain/effects` + تعریف‌ها |

---

## فهرست دیاگرام‌ها

1. [معماری کلی سامانه](#01-architecture) — دستی
2. [گراف وابستگی ماژول‌ها](#02-module-graph) — تولیدی
3. [نمودار موجودیت-رابطه (نمای کلی)](#03-erd-overview) — تولیدی
4. [نمودار موجودیت-رابطه (کامل)](#04-erd-full) — تولیدی
5. [چرخه عمر یک گذار](#05-transition-lifecycle) — دستی
6. [درون موتور گردش‌کار](#06-engine-plan) — دستی
7. [گردش‌کار قرارداد (contract v1)](#07-workflow-contract) — تولیدی
8. [گردش‌کار آگهی (listing v1)](#08-workflow-listing) — تولیدی
9. [گردش‌کار نیازمندی‌ها (requirements v1)](#09-workflow-requirements) — تولیدی
10. [گردش‌کار سایر خدمات (custom_service v1)](#10-workflow-custom-service) — تولیدی
11. [نگاشت گاردها و افکت‌ها](#11-guards-effects-map) — تولیدی
12. [سینک Push (اینگست)](#12-sync-push) — دستی
13. [سینک Pull و Webhook خروجی](#13-sync-pull-webhook) — دستی
14. [احراز هویت، نشست و RBAC](#14-auth-session) — دستی
15. [نقشه پنل و API](#15-panel-sitemap) — دستی
16. [استقرار با داکر](#16-deployment) — دستی

---

## 01-architecture

### معماری کلی سامانه

لایه‌ها (وب، سرویس، دامنه خالص، داده)، ورودی‌های بیرونی (کارمند، سرور اصلی، cron) و وابستگی بین آن‌ها.

* فایل: [`01-architecture.mmd`](./01-architecture.mmd) — نگهداری دستی

```mermaid
flowchart LR
  classDef ext fill:#f1f5f9,stroke:#475569,color:#0f172a,stroke-width:1px;
  classDef web fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a;
  classDef app fill:#ede9fe,stroke:#6d28d9,color:#4c1d95;
  classDef dom fill:#dcfce7,stroke:#15803d,color:#14532d;
  classDef data fill:#fef3c7,stroke:#b45309,color:#78350f;
  classDef sec fill:#fce7f3,stroke:#be185d,color:#831843;

  Staff["کارشناس / مدیر<br/>مرورگر RTL · تقویم جلالی"]:::ext
  Main["سرور اصلی کارفرما<br/>کاربران · قراردادها · آگهی‌ها · نیازمندی‌ها"]:::ext
  Cron["زمان‌بند سرور (cron)<br/>هر ۵ تا ۱۵ دقیقه"]:::ext

  subgraph CRM["CRM خودمیزبان — Next.js 16 App Router روی Node 22.5+ (خروجی standalone)"]
    direction TB

    subgraph WEB["لایه وب — src/app"]
      direction LR
      Proxy["src/proxy.ts<br/>تبدیل ?t=… به هدر X-Session-Ticket"]:::web
      Panel["پنل کارکنان /panel/**<br/>Server Components + Server Actions"]:::web
      ApiSync["API سینک /api/v1/**<br/>ingest/[entity] · jobs/pull · jobs/dispatch-webhooks"]:::web
      ApiMisc["/api/health · /api/auth/session · /logout · /login"]:::web
    end

    subgraph APPL["لایه سرویس — src/services و src/domain/service"]
      direction LR
      Svc["CaseService<br/>createCase · applyTransition · loadRuntime<br/>recordPaymentAttempt · markSignature · reviewDocument"]:::app
      Sync["sync.ts<br/>ingest · pullOnce · dispatchDueWebhooks · syncOverview"]:::app
      Defs["definitions.ts<br/>seed تعریف گردش‌کارها و خدمات"]:::app
      Auth["src/auth/**<br/>session · jwt · csrf · rbac · password · ticket · demo"]:::sec
    end

    subgraph DOM["دامنه خالص (بدون I/O) — src/domain"]
      direction LR
      WF["workflows<br/>buildEngine + ثبت گاردها و افکت‌ها"]:::dom
      Engine["engine<br/>available · plan · validate"]:::dom
      Guards["guards<br/>۳۲ گارد نام‌دار"]:::dom
      Effects["effects<br/>۲۵ افکت نام‌دار"]:::dom
      Adapters["adapters<br/>پرداخت · کد رهگیری · اعلان"]:::dom
    end

    subgraph DATA["لایه داده — src/db"]
      direction LR
      Repos["repos<br/>cases · catalog · finance · people · platform"]:::data
      Client["client.ts<br/>node:sqlite · WAL · کوئری پارامتری"]:::data
      Migrate["migrate.ts<br/>مهاجرت نسخه‌دار"]:::data
      DB[("SQLite<br/>/data/crm.db — ۳۱ جدول")]:::data
    end

    WFD[("workflow-definitions/*.json<br/>منبع حقیقت گردش‌کارها")]:::data
    Libs["src/lib<br/>errors · ids · jalali · money · fa-labels"]:::data
  end

  Staff -->|"HTTPS + کوکی نشست"| Proxy
  Proxy --> Panel
  Proxy --> ApiMisc
  Main -->|"Push: POST /api/v1/ingest/*<br/>X-Sync-Key + X-Signature (HMAC)"| ApiSync
  ApiSync -->|"Pull: GET {SYNC_PULL_URL}/{entity}?since=…"| Main
  ApiSync -->|"Webhook خروجی: POST با X-Webhook-Signature"| Main
  Cron -->|"POST /api/v1/jobs/pull<br/>POST /api/v1/jobs/dispatch-webhooks"| ApiSync

  Panel --> Auth
  Panel --> Svc
  Panel --> Sync
  Panel --> Defs
  ApiSync --> Sync
  ApiSync --> Auth
  Sync --> Svc
  Sync --> Repos
  Defs --> WFD
  Defs --> Repos

  Svc --> WF
  Svc --> Repos
  Svc --> Adapters
  Svc --> Auth
  WF --> Engine
  WF --> Guards
  WF --> Effects
  Engine --> Guards
  Engine --> Effects

  Repos --> Client
  Client --> DB
  Migrate --> DB
  Auth --> Repos
  Engine -.->|"خواندن وضعیت جهان"| Repos
  Svc --> Libs
  Panel --> Libs
  Sync --> Libs
```

---

## 02-module-graph

### گراف وابستگی ماژول‌ها

یال‌ها از import های واقعی `@/…` در `src/**` استخراج می‌شوند؛ جهت وابستگی لایه‌ها را نشان می‌دهد.

* فایل: [`02-module-graph.mmd`](./02-module-graph.mmd) — تولید خودکار از کد (`npm run diagrams`)

```mermaid
flowchart LR
  classDef web fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a;
  classDef app fill:#ede9fe,stroke:#6d28d9,color:#4c1d95;
  classDef dom fill:#dcfce7,stroke:#15803d,color:#14532d;
  classDef data fill:#fef3c7,stroke:#b45309,color:#78350f;
  classDef sec fill:#fce7f3,stroke:#be185d,color:#831843;

  subgraph SG_web["لایه وب — src/app"]
    direction TB
    M_app_root["app — layout و صفحه ریشه<br/><small>2 فایل</small>"]:::web
    M_app_login["app/login — ورود<br/><small>3 فایل</small>"]:::web
    M_app_logout["app/logout — خروج<br/><small>1 فایل</small>"]:::web
    M_app_panel["app/panel — پنل کارکنان<br/><small>21 فایل</small>"]:::web
    M_app_api["app/api — health و v1<br/><small>5 فایل</small>"]:::web
  end

  subgraph SG_client["کلاینت مشترک"]
    direction TB
    M_components["components/session-bridge<br/><small>2 فایل</small>"]:::web
  end

  subgraph SG_security["احراز هویت — src/auth"]
    direction TB
    M_auth["auth — session/jwt/csrf/rbac/password/ticket<br/><small>7 فایل</small>"]:::sec
  end

  subgraph SG_app["لایه سرویس — src/services"]
    direction TB
    M_services_sync["services/sync.ts<br/><small>1 فایل</small>"]:::app
    M_services_definitions["services/definitions.ts<br/><small>1 فایل</small>"]:::app
  end

  subgraph SG_domain["دامنه — src/domain"]
    direction TB
    M_domain_service["domain/service — CaseService<br/><small>1 فایل</small>"]:::dom
    M_domain_workflows["domain/workflows — buildEngine<br/><small>1 فایل</small>"]:::dom
    M_domain_engine["domain/engine — plan/available/validate<br/><small>3 فایل</small>"]:::dom
    M_domain_guards["domain/guards<br/><small>1 فایل</small>"]:::dom
    M_domain_effects["domain/effects<br/><small>1 فایل</small>"]:::dom
    M_domain_adapters["domain/adapters — پرداخت/رهگیری/اعلان<br/><small>1 فایل</small>"]:::dom
  end

  subgraph SG_data["داده — src/db"]
    direction TB
    M_db_repos["db/repos — cases/catalog/finance/people/platform<br/><small>5 فایل</small>"]:::data
    M_db_core["db/core — client/migrate<br/><small>2 فایل</small>"]:::data
  end

  subgraph SG_shared["مشترک"]
    direction TB
    M_lib["lib — errors/ids/jalali/money/fa-labels<br/><small>5 فایل</small>"]:::data
  end

  M_app_api -->|3| M_auth
  M_app_api -->|5| M_db_core
  M_app_api ==>|6| M_db_repos
  M_app_api -->|1| M_domain_workflows
  M_app_api -->|1| M_lib
  M_app_api -->|3| M_services_sync
  M_app_login ==>|6| M_auth
  M_app_login -->|1| M_components
  M_app_login -->|2| M_db_core
  M_app_login -->|3| M_db_repos
  M_app_logout -->|1| M_auth
  M_app_panel ==>|29| M_auth
  M_app_panel -->|1| M_components
  M_app_panel -->|1| M_db_core
  M_app_panel ==>|46| M_db_repos
  M_app_panel -->|3| M_domain_engine
  M_app_panel -->|2| M_domain_service
  M_app_panel ==>|8| M_domain_workflows
  M_app_panel ==>|45| M_lib
  M_app_panel -->|1| M_services_definitions
  M_app_panel -->|2| M_services_sync
  M_app_root -->|1| M_auth
  M_app_root -->|1| M_components
  M_auth -->|2| M_db_repos
  M_auth -->|4| M_lib
  M_db_repos -->|5| M_db_core
  M_db_repos -->|5| M_lib
  M_domain_adapters -->|1| M_lib
  M_domain_effects -->|1| M_domain_engine
  M_domain_effects -->|1| M_lib
  M_domain_engine -->|1| M_lib
  M_domain_guards -->|1| M_domain_engine
  M_domain_service -->|1| M_db_core
  M_domain_service -->|5| M_db_repos
  M_domain_service -->|1| M_domain_adapters
  M_domain_service -->|1| M_domain_engine
  M_domain_service -->|1| M_domain_workflows
  M_domain_service -->|3| M_lib
  M_domain_workflows -->|1| M_domain_effects
  M_domain_workflows -->|3| M_domain_engine
  M_domain_workflows -->|1| M_domain_guards
  M_lib -->|1| M_domain_engine
  M_services_definitions -->|1| M_db_core
  M_services_definitions -->|2| M_db_repos
  M_services_definitions -->|1| M_domain_workflows
  M_services_sync -->|1| M_db_core
  M_services_sync -->|5| M_db_repos
  M_services_sync -->|1| M_domain_service
  M_services_sync -->|1| M_domain_workflows
  M_services_sync -->|2| M_lib
```

---

## 03-erd-overview

### نمودار موجودیت-رابطه (نمای کلی)

۳۱ جدول دیتابیس و رابطه‌های آن‌ها بدون جزئیات ستون‌ها — برای دیدن شکل کلی داده.

* فایل: [`03-erd-overview.mmd`](./03-erd-overview.mmd) — تولید خودکار از کد (`npm run diagrams`)

```mermaid
erDiagram
  STAFF ||--o{ SESSIONS : "کارمند"
  CASES ||--o{ CASE_TRANSITIONS : "پرونده"
  CASES ||--o{ TIMELINE_EVENTS : "پرونده"
  CASES |o--o{ TASKS : "پرونده"
  CASES ||--o{ DOCUMENTS : "پرونده"
  CASES ||--|| CONTRACT_DETAILS : "پرونده"
  CASES ||--o{ LEGAL_REVIEWS : "پرونده"
  CASES ||--o{ SIGNATURES : "پرونده"
  CASES ||--|| TRACKING_REQUESTS : "پرونده"
  CASES ||--o{ INVOICES : "پرونده"
  CASES ||--o{ PAYMENTS : "پرونده"
  INVOICES |o--o{ PAYMENTS : "فاکتور"
  REFERRAL_CODES ||--o{ REFERRAL_USES : "کد ریفرال"
  CASES ||--o{ REFERRAL_USES : "پرونده"
  CASES |o--o{ LISTINGS : "پرونده"
  CASES |o--o{ REQUIREMENTS : "پرونده"
  REQUIREMENTS ||--o{ REQUIREMENT_MATCHES : "نیازمندی"
  SYNC_LOG |o--o{ SYNC_ITEM_RESULTS : "لاگ سینک"
  SERVICES ||--o{ CASES : "خدمت (service_key) — منطقی"
  WORKFLOW_DEFINITIONS ||--o{ CASES : "گردش‌کار (workflow_key) — منطقی"
  USERS |o--o{ CASES : "مالک پرونده — منطقی"
  USERS |o--o{ CASES : "کارگزار — منطقی"
  STAFF |o--o{ CASES : "کارشناس مسئول — منطقی"
  STAFF |o--o{ TASKS : "انجام‌دهنده وظیفه — منطقی"
  STAFF |o--o{ TASKS : "سازنده وظیفه — منطقی"
  STAFF |o--o{ DOCUMENTS : "بررسی‌کننده مدرک — منطقی"
  STAFF |o--o{ LEGAL_REVIEWS : "بررسی‌کننده حقوقی — منطقی"
  STAFF |o--o{ TIMELINE_EVENTS : "کنشگر رویداد — منطقی"
  USERS |o--o{ SUBSCRIPTIONS : "اشتراک کاربر — منطقی"
  USERS |o--o{ REFERRAL_CODES : "صاحب کد — منطقی"
  STAFF |o--o{ REFERRAL_USES : "تأییدکننده مصرف — منطقی"
  USERS |o--o{ LISTINGS : "مالک آگهی — منطقی"
  USERS |o--o{ LISTINGS : "کارگزار آگهی — منطقی"
  USERS |o--o{ REQUIREMENTS : "درخواست‌کننده نیازمندی — منطقی"
  LISTINGS ||--o{ REQUIREMENT_MATCHES : "آگهی تطبیق‌شده — منطقی"
  USERS |o--o{ NOTIFICATIONS : "گیرنده پیام — منطقی"
  CASES |o--o{ NOTIFICATIONS : "پرونده مرتبط — منطقی"
  CASES |o--o{ OUTBOUND_WEBHOOKS : "پرونده مرتبط — منطقی"
```

---

## 04-erd-full

### نمودار موجودیت-رابطه (کامل)

همه ستون‌ها با نوع و نشانگر PK/FK/UK به‌همراه رابطه‌های صریح (REFERENCES) و منطقی (بدون FK).

* فایل: [`04-erd-full.mmd`](./04-erd-full.mmd) — تولید خودکار از کد (`npm run diagrams`)

```mermaid
erDiagram
  STAFF ||--o{ SESSIONS : "کارمند"
  CASES ||--o{ CASE_TRANSITIONS : "پرونده"
  CASES ||--o{ TIMELINE_EVENTS : "پرونده"
  CASES |o--o{ TASKS : "پرونده"
  CASES ||--o{ DOCUMENTS : "پرونده"
  CASES ||--|| CONTRACT_DETAILS : "پرونده"
  CASES ||--o{ LEGAL_REVIEWS : "پرونده"
  CASES ||--o{ SIGNATURES : "پرونده"
  CASES ||--|| TRACKING_REQUESTS : "پرونده"
  CASES ||--o{ INVOICES : "پرونده"
  CASES ||--o{ PAYMENTS : "پرونده"
  INVOICES |o--o{ PAYMENTS : "فاکتور"
  REFERRAL_CODES ||--o{ REFERRAL_USES : "کد ریفرال"
  CASES ||--o{ REFERRAL_USES : "پرونده"
  CASES |o--o{ LISTINGS : "پرونده"
  CASES |o--o{ REQUIREMENTS : "پرونده"
  REQUIREMENTS ||--o{ REQUIREMENT_MATCHES : "نیازمندی"
  SYNC_LOG |o--o{ SYNC_ITEM_RESULTS : "لاگ سینک"
  SERVICES ||--o{ CASES : "خدمت (service_key) — منطقی"
  WORKFLOW_DEFINITIONS ||--o{ CASES : "گردش‌کار (workflow_key) — منطقی"
  USERS |o--o{ CASES : "مالک پرونده — منطقی"
  USERS |o--o{ CASES : "کارگزار — منطقی"
  STAFF |o--o{ CASES : "کارشناس مسئول — منطقی"
  STAFF |o--o{ TASKS : "انجام‌دهنده وظیفه — منطقی"
  STAFF |o--o{ TASKS : "سازنده وظیفه — منطقی"
  STAFF |o--o{ DOCUMENTS : "بررسی‌کننده مدرک — منطقی"
  STAFF |o--o{ LEGAL_REVIEWS : "بررسی‌کننده حقوقی — منطقی"
  STAFF |o--o{ TIMELINE_EVENTS : "کنشگر رویداد — منطقی"
  USERS |o--o{ SUBSCRIPTIONS : "اشتراک کاربر — منطقی"
  USERS |o--o{ REFERRAL_CODES : "صاحب کد — منطقی"
  STAFF |o--o{ REFERRAL_USES : "تأییدکننده مصرف — منطقی"
  USERS |o--o{ LISTINGS : "مالک آگهی — منطقی"
  USERS |o--o{ LISTINGS : "کارگزار آگهی — منطقی"
  USERS |o--o{ REQUIREMENTS : "درخواست‌کننده نیازمندی — منطقی"
  LISTINGS ||--o{ REQUIREMENT_MATCHES : "آگهی تطبیق‌شده — منطقی"
  USERS |o--o{ NOTIFICATIONS : "گیرنده پیام — منطقی"
  CASES |o--o{ NOTIFICATIONS : "پرونده مرتبط — منطقی"
  CASES |o--o{ OUTBOUND_WEBHOOKS : "پرونده مرتبط — منطقی"

  SCHEMA_MIGRATIONS {
    text version PK "نسخه"
    text applied_at
  }
  SETTINGS {
    text key PK "کلید"
    text value
    text updated_at "زمان به‌روزرسانی"
  }
  STAFF {
    text id PK "شناسه یکتا"
    text username UK "نام کاربری"
    text password_hash "هش رمز (scrypt)"
    text full_name "نام کامل"
    text role "نقش"
    integer active "فعال است"
    text sso_subject UK
    text last_login_at
    text created_at "زمان ایجاد"
    text updated_at "زمان به‌روزرسانی"
  }
  SESSIONS {
    text id PK "شناسه یکتا"
    text staff_id FK "کارمند"
    text token_hash UK "هش توکن نشست"
    text user_agent
    text ip
    text created_at "زمان ایجاد"
    text expires_at "انقضا"
    text revoked_at "زمان ابطال"
  }
  USERS {
    text id PK "شناسه یکتا"
    text external_id "شناسه در سرور اصلی"
    text source "منبع داده"
    text full_name "نام کامل"
    text national_id
    text mobile "موبایل"
    text email "رایانامه"
    text user_type
    text agent_license_no
    text city "شهر"
    text status "وضعیت"
    integer deleted "حذف‌شده"
    text payload_hash
    text raw
    text synced_at
    text created_at "زمان ایجاد"
    text updated_at "زمان به‌روزرسانی"
  }
  SERVICES {
    text id PK "شناسه یکتا"
    text key UK "کلید"
    text name "نام"
    text category
    text description
    integer price "قیمت"
    integer requires_subscription
    integer requires_referral
    text workflow_key "کلید گردش‌کار"
    text required_documents
    integer active "فعال است"
    integer sort_order
    text created_at "زمان ایجاد"
    text updated_at "زمان به‌روزرسانی"
  }
  CASES {
    text id PK "شناسه یکتا"
    text code UK "کد"
    text external_id "شناسه در سرور اصلی"
    text source "منبع داده"
    text title "عنوان"
    text service_key "کلید خدمت"
    text workflow_key "کلید گردش‌کار"
    integer workflow_version "نسخه قفل‌شده گردش‌کار"
    text state "حالت گردش‌کار"
    text status "وضعیت"
    text outcome "نتیجه پرونده"
    text priority "اولویت"
    text owner_user_id
    text agent_user_id
    text assigned_staff_id
    text due_at "سررسید"
    integer requires_tracking "نیاز به کد رهگیری"
    text access_level "سطح دسترسی"
    text queue "صف کاری"
    integer attempts_payment "تلاش‌های پرداخت"
    integer attempts_tracking "تلاش‌های کد رهگیری"
    text meta
    text opened_at
    text closed_at
    text last_transition_at
    text created_at "زمان ایجاد"
    text updated_at "زمان به‌روزرسانی"
  }
  CASE_TRANSITIONS {
    text id PK "شناسه یکتا"
    text case_id FK "پرونده"
    text from_state
    text to_state
    text transition_key
    text transition_name
    text option
    text actor_type
    text actor_id
    text actor_name
    text reason
    text payload "بار JSON"
    text idempotency_key UK "کلید یکتاسازی"
    text at "زمان رویداد"
  }
  TIMELINE_EVENTS {
    text id PK "شناسه یکتا"
    text case_id FK "پرونده"
    text kind
    text title "عنوان"
    text body
    text visibility
    text actor_id
    text actor_name
    text at "زمان رویداد"
    text meta
  }
  TASKS {
    text id PK "شناسه یکتا"
    text case_id FK "پرونده"
    text title "عنوان"
    text description
    text priority "اولویت"
    text assignee_id
    text due_at "سررسید"
    text status "وضعیت"
    text result_note
    text created_by
    text dedupe_key UK
    text created_at "زمان ایجاد"
    text updated_at "زمان به‌روزرسانی"
    text completed_at
  }
  DOCUMENTS {
    text id PK "شناسه یکتا"
    text case_id FK "پرونده"
    text kind
    text title "عنوان"
    text status "وضعیت"
    text note "یادداشت"
    text review_note
    text reviewed_by
    text reviewed_at
    text file_name
    integer version "نسخه"
    text created_at "زمان ایجاد"
    text updated_at "زمان به‌روزرسانی"
  }
  CONTRACT_DETAILS {
    text id PK "شناسه یکتا"
    text case_id FK, UK "پرونده"
    text contract_type "نوع قرارداد (rent/sale)"
    text output_mode "خروجی موردنیاز"
    text property_address
    text city "شهر"
    text district "محله"
    real area "متراژ"
    text landlord_name
    text tenant_name
    text seller_name
    text buyer_name
    integer deposit_amount
    integer rent_amount
    integer sale_price
    text start_date
    text end_date
    text terms_note
    integer clause_version "نسخه بندها"
    text document_generated_at
    text created_at "زمان ایجاد"
    text updated_at "زمان به‌روزرسانی"
  }
  LEGAL_REVIEWS {
    text id PK "شناسه یکتا"
    text case_id FK "پرونده"
    text reviewer_id
    text result
    text note "یادداشت"
    integer clause_version_at_review
    text at "زمان رویداد"
  }
  SIGNATURES {
    text id PK "شناسه یکتا"
    text case_id FK "پرونده"
    text party
    text party_name
    text status "وضعیت"
    text method "روش"
    text signed_at
    text note "یادداشت"
    text created_at "زمان ایجاد"
  }
  TRACKING_REQUESTS {
    text id PK "شناسه یکتا"
    text case_id FK, UK "پرونده"
    text status "وضعیت"
    text code "کد"
    text error
    integer attempts "شمار تلاش‌ها"
    text requested_at
    text received_at
    text updated_at "زمان به‌روزرسانی"
  }
  INVOICES {
    text id PK "شناسه یکتا"
    text case_id FK "پرونده"
    text title "عنوان"
    integer amount "مبلغ"
    text status "وضعیت"
    text method "روش"
    text created_at "زمان ایجاد"
    text paid_at
  }
  PAYMENTS {
    text id PK "شناسه یکتا"
    text case_id FK "پرونده"
    text invoice_id FK
    text method "روش"
    integer amount "مبلغ"
    text status "وضعیت"
    text provider
    text provider_ref
    text error
    integer attempt "شماره تلاش"
    text paid_at
    text created_at "زمان ایجاد"
  }
  SUBSCRIPTIONS {
    text id PK "شناسه یکتا"
    text user_id "کاربر"
    text plan_key
    text scope
    text starts_at
    text ends_at
    text status "وضعیت"
    text created_at "زمان ایجاد"
  }
  REFERRAL_CODES {
    text id PK "شناسه یکتا"
    text code UK "کد"
    text kind
    text owner_user_id
    text scope
    integer max_uses
    integer used_count
    text expires_at "انقضا"
    integer active "فعال است"
    text note "یادداشت"
    text created_at "زمان ایجاد"
  }
  REFERRAL_USES {
    text id PK "شناسه یکتا"
    text code_id FK
    text case_id FK "پرونده"
    text approved_by
    text used_at
  }
  LISTINGS {
    text id PK "شناسه یکتا"
    text case_id FK "پرونده"
    text external_id "شناسه در سرور اصلی"
    text source "منبع داده"
    text owner_user_id
    text agent_user_id
    text deal_type "نوع معامله"
    text property_type "نوع ملک"
    text city "شهر"
    text district "محله"
    text address "نشانی"
    real area "متراژ"
    integer rooms
    integer year_built
    integer price "قیمت"
    integer deposit
    integer rent
    text description
    text amenities
    text images
    text status "وضعیت"
    text reject_reason
    text published_at
    text expires_at "انقضا"
    integer views
    text created_at "زمان ایجاد"
    text updated_at "زمان به‌روزرسانی"
  }
  REQUIREMENTS {
    text id PK "شناسه یکتا"
    text case_id FK "پرونده"
    text external_id "شناسه در سرور اصلی"
    text source "منبع داده"
    text requester_user_id
    text deal_type "نوع معامله"
    text property_type "نوع ملک"
    text city "شهر"
    text districts
    integer budget_min
    integer budget_max
    real area_min
    real area_max
    integer rooms
    text description
    text access_level "سطح دسترسی"
    text status "وضعیت"
    text expires_at "انقضا"
    text created_at "زمان ایجاد"
    text updated_at "زمان به‌روزرسانی"
  }
  REQUIREMENT_MATCHES {
    text id PK "شناسه یکتا"
    text requirement_id FK
    text listing_id
    real score "امتیاز تطبیق"
    text note "یادداشت"
    text at "زمان رویداد"
  }
  NOTIFICATIONS {
    text id PK "شناسه یکتا"
    text channel "کانال"
    text template "قالب پیام"
    text to_user_id
    text to_address
    text case_id "پرونده"
    text body
    text status "وضعیت"
    text error
    text provider
    text sent_at
    text created_at "زمان ایجاد"
  }
  WORKFLOW_DEFINITIONS {
    text id PK "شناسه یکتا"
    text key "کلید"
    integer version "نسخه"
    text name "نام"
    text definition "JSON تعریف"
    integer active "فعال است"
    text created_at "زمان ایجاد"
    text activated_at
  }
  SYNC_LOG {
    text id PK "شناسه یکتا"
    text direction "جهت سینک"
    text channel "کانال"
    text entity_type "نوع موجودیت"
    text source "منبع داده"
    text idempotency_key "کلید یکتاسازی"
    integer item_count
    integer created
    integer updated
    integer unchanged
    integer rejected
    text status "وضعیت"
    text detail
    text actor
    integer duration_ms
    text at "زمان رویداد"
  }
  SYNC_ITEM_RESULTS {
    text id PK "شناسه یکتا"
    text sync_log_id FK
    text entity_type "نوع موجودیت"
    text external_id "شناسه در سرور اصلی"
    text action
    text reason
    text at "زمان رویداد"
  }
  OUTBOUND_WEBHOOKS {
    text id PK "شناسه یکتا"
    text event "رویداد"
    text case_id "پرونده"
    text payload "بار JSON"
    text target_url "آدرس مقصد"
    text status "وضعیت"
    integer attempts "شمار تلاش‌ها"
    text last_error
    text next_attempt_at
    text delivered_at
    text created_at "زمان ایجاد"
    text updated_at "زمان به‌روزرسانی"
  }
  PULL_CURSORS {
    text id PK "شناسه یکتا"
    text entity_type UK "نوع موجودیت"
    text last_pulled_at "آخرین واکشی"
    text last_cursor
    text updated_at "زمان به‌روزرسانی"
  }
  AUDIT_LOG {
    text id PK "شناسه یکتا"
    text actor_type
    text actor_id
    text actor_name
    text action
    text entity_type "نوع موجودیت"
    text entity_id
    text detail
    text ip
    text at "زمان رویداد"
  }
  IDEMPOTENCY_KEYS {
    text key PK "کلید"
    text scope
    integer status "وضعیت"
    text response
    text created_at "زمان ایجاد"
    text expires_at "انقضا"
  }
```

---

## 05-transition-lifecycle

### چرخه عمر یک گذار

از کلیک کارشناس در پنل تا CSRF/RBAC، engine.plan، تراکنش دیتابیس، اعلان‌ها و صف وب‌هوک.

* فایل: [`05-transition-lifecycle.mmd`](./05-transition-lifecycle.mmd) — نگهداری دستی

```mermaid
sequenceDiagram
  autonumber
  actor U as کارشناس / مدیر
  participant B as مرورگر (پنل RTL)
  participant SA as Server Action — src/app/panel/cases/actions.ts
  participant AU as src/auth — نشست، CSRF، RBAC
  participant SV as CaseService.applyTransition
  participant EN as Engine.plan (خالص، بدون I/O)
  participant DB as مخازن SQLite (src/db/repos)
  participant AD as آداپتورها + صف وب‌هوک

  U->>B: انتخاب اقدام یا گزینه گذار
  B->>SA: ارسال فرم با توکن CSRF امضاشده
  SA->>AU: verifyCsrfToken + requireSession + assertCan
  AU-->>SA: نقش (staff/admin) و شناسه کارمند
  SA->>SV: applyTransition(caseId, transitionKey, option, reason, payload, idempotencyKey)

  SV->>DB: loadRuntime(caseId) — وضعیت جهان
  DB-->>SV: قرارداد، مدارک، امضاها، پرداخت‌ها، رهگیری، وظایف، تنظیمات

  alt کلید idempotency قبلاً دیده شده
    SV->>DB: getIdempotentResponse
    DB-->>SV: پاسخ ذخیره‌شده
    SV-->>SA: بازپخش نتیجه قبلی (بدون اثر دوباره)
  else درخواست تازه
    SV->>EN: plan(runtime, transitionKey, option, actor, reason, payload)
    EN->>EN: اعتبارسنجی گذار (از این حالت ممکن است؟)
    EN->>EN: canActor — نقش مجاز است؟
    EN->>EN: گاردهای سطح گذار و سطح گزینه
    EN->>EN: ساخت ApplyPlan با اجرای افکت‌ها
    EN->>EN: زنجیره گذارهای auto (حداکثر ۲۵ گام + تشخیص حلقه)

    alt گارد رد شد
      EN-->>SV: GuardFailedError با پیام فارسی
      SV-->>SA: خطا
      SA-->>B: نمایش دلیل (مثلاً «برای اجاره، آدرس ملک و نام مالک الزامی است»)
      B-->>U: پیام خطا روی همان فرم
    else گاردها پذیرفتند
      EN-->>SV: ApplyPlan (casePatch, events, tasks, documents, signatures, invoice, payment, outbound)
      SV->>DB: یک تراکنش — cases + case_transitions + timeline_events + tasks + documents + signatures + tracking + invoices + payments + audit_log
      SV->>DB: ذخیره پاسخ idempotency (TTL ۴۸ ساعت)
      DB-->>SV: commit
      SV->>AD: پس از تراکنش — ارسال اعلان‌ها و ثبت در notifications
      SV->>AD: صف‌کردن وب‌هوک خروجی (outbound_webhooks)
      SV-->>SA: نتیجه (from → to) + runtime تازه
      SA->>SA: revalidatePath
      SA-->>B: پیام موفقیت + داده به‌روز
      B-->>U: وضعیت تازه پرونده، تایم‌لاین و دکمه‌های مجاز
    end
  end
```

---

## 06-engine-plan

### درون موتور گردش‌کار

منطق `Engine.plan`: اعتبارسنجی، گاردها، گزینه‌ها، زنجیره گذارهای خودکار (سقف ۲۵ گام + تشخیص حلقه) و حالت پایانی.

* فایل: [`06-engine-plan.mmd`](./06-engine-plan.mmd) — نگهداری دستی

```mermaid
flowchart TD
  classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d;
  classDef err fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d;
  classDef proc fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a;
  classDef dec fill:#fef3c7,stroke:#b45309,color:#78350f;
  classDef pure fill:#ede9fe,stroke:#6d28d9,color:#4c1d95;

  In(["ورودی: ApplyInput<br/>runtime + transitionKey + option + actor + reason + payload"]):::proc

  In --> T1{"گذار با این کلید<br/>در تعریف وجود دارد؟"}:::dec
  T1 -->|نه| E1["AppError INVALID_TRANSITION<br/>«گذار … در این گردش‌کار وجود ندارد»"]:::err
  T1 -->|بله| T2{"runtime.state<br/>در tr.from هست؟"}:::dec
  T2 -->|نه| E2["AppError INVALID_TRANSITION<br/>«این گذار از وضعیت … امکان‌پذیر نیست»"]:::err
  T2 -->|بله| T3{"canActor<br/>نقش/مبدأ مجاز است؟"}:::dec
  T3 -->|نه| E3["AppError FORBIDDEN<br/>پیام فارسی نقش مجاز"]:::err
  T3 -->|بله| G1{"گاردهای سطح گذار<br/>همه قبول‌اند؟"}:::dec
  G1 -->|نه| E4["GuardFailedError<br/>پیام فارسی گارد + withReason"]:::err
  G1 -->|بله| K1{"kind == choice ؟"}:::dec

  K1 -->|بله| O1{"گزینه انتخاب شده<br/>و تعریف‌شده است؟"}:::dec
  O1 -->|نه| E5["AppError VALIDATION<br/>«باید یکی از گزینه‌ها انتخاب شود»"]:::err
  O1 -->|بله| G2{"گاردهای سطح گزینه"}:::dec
  G2 -->|رد| E4
  G2 -->|قبول| P1
  K1 -->|خیر| P1["planSingle<br/>مقصد = tr.to"]:::pure

  P1 --> FX["اجرای افکت‌ها روی ApplyPlan<br/>transition.effects سپس option.effects<br/>record_event · create_followup_task · emit_invoice · …"]:::pure
  FX --> PATCH["applyPatchToRuntime<br/>پچ نقشه روی وضعیت جهان (برای گاردهای گام بعد)"]:::pure

  PATCH --> LOOP{"گذار auto با actors=system<br/>از حالت فعلی وجود دارد؟"}:::dec
  LOOP -->|نه| FIN
  LOOP -->|بله| STEP{"گام < ۲۵ ؟"}:::dec
  STEP -->|نه — سقف زنجیره| FIN
  STEP -->|بله| GC{"گاردهای نامزد auto<br/>قبول‌اند؟"}:::dec
  GC -->|هیچ‌کدام| W1["plan.warnings += «گذار خودکار عبور نکرد»"]:::err
  W1 --> FIN
  GC -->|بله| CYC{"امضا state:transition<br/>قبلاً دیده شده؟"}:::dec
  CYC -->|بله| W2["plan.warnings += «حلقه خودکار شناسایی شد»"]:::err
  W2 --> FIN
  CYC -->|نه| MERGE["ادغام نقشه خودکار در نقشه اصلی<br/>to · events · tasks · documents · signatures · outbound<br/>mergeCasePatch"]:::pure
  MERGE --> LOOP

  FIN{"حالت مقصد terminal است؟"}:::dec
  FIN -->|بله| TERM["اجرای crm.onTerminal<br/>outcome + status = closed"]:::ok
  FIN -->|نه| OUT
  TERM --> OUT(["خروجی: ApplyPlan<br/>casePatch · events · tasks · notifications · documents · signatures<br/>trackingRequest · invoice · payment · outbound · traces · warnings"]):::ok

  subgraph VAL["اعتبارسنجی تعریف — validate.ts (هنگام import/seed از پنل)"]
    direction TB
    V1["حالت تکراری یا گذار بی‌مرجع"]:::dec
    V2["حالت بن‌بست (بدون خروجی و غیر terminal)"]:::dec
    V3["گذار auto بدون نقش سیستمی"]:::dec
    V4["کلید گارد یا افکت ناشناس"]:::dec
  end
  VAL -.->|"assertValidDefinition پیش از فعال‌سازی نسخه"| In

  subgraph AVAIL["Engine.available — ساخت دکمه‌های پنل"]
    direction TB
    A1["فقط گذارهای from == state فعلی"]:::pure
    A2["گذارهای auto حذف می‌شوند (خودکار اجرا می‌شوند)"]:::pure
    A3["برای هر گذار: canActor + گاردها → allowed/reason"]:::pure
    A4["برای choice: وضعیت مجاز هر گزینه جداگانه"]:::pure
  end
```

---

## 07-workflow-contract

### گردش‌کار قرارداد (contract v1)

۳۳ حالت و ۴۱ گذار: انتخاب خدمت → اطلاعات قرارداد → مالی → مدارک → حقوقی → امضا → کد رهگیری → بستن پرونده.

* فایل: [`07-workflow-contract.mmd`](./07-workflow-contract.mmd) — تولید خودکار از کد (`npm run diagrams`)

```mermaid
stateDiagram-v2
  direction TB
  state "شروع پرونده قرارداد ⟦آغاز⟧<br/>contract_start" as contract_start
  state "ثبت اطلاعات اجاره<br/>rent_info" as rent_info
  state "ثبت اطلاعات خرید و فروش<br/>sale_info" as sale_info
  state "تعیین خروجی موردنیاز ⟦تصمیم⟧<br/>output_choice" as output_choice
  state "بدون کد رهگیری<br/>no_tracking" as no_tracking
  state "با درخواست کد رهگیری<br/>with_tracking" as with_tracking
  state "تشکیل پرونده خدمت<br/>case_created" as case_created
  state "بررسی شرایط مالی مختص همین خدمت ⟦تصمیم⟧<br/>finance_check" as finance_check
  state "پرداخت مستقیم ⟦تصمیم⟧<br/>payment_direct" as payment_direct
  state "اشتراک برای این خدمت معتبر است؟ ⟦تصمیم⟧<br/>subscription_check" as subscription_check
  state "شرایط ریفرال یا معافیت تأیید شده است؟ ⟦تصمیم⟧<br/>referral_check" as referral_check
  state "ثبت خطا و پیگیری پرداخت ⟦خطا/حلقه⟧<br/>payment_error" as payment_error
  state "تأیید وضعیت مالی<br/>finance_ok" as finance_ok
  state "بررسی مدارک قرارداد ⟦تصمیم⟧<br/>documents_review" as documents_review
  state "اعلام مدارک موردنیاز ⟦خطا/حلقه⟧<br/>documents_incomplete" as documents_incomplete
  state "اعلام دلیل رد و درخواست اصلاح ⟦خطا/حلقه⟧<br/>documents_rejected" as documents_rejected
  state "صف بررسی کارشناس<br/>documents_pending_queue" as documents_pending_queue
  state "نوع قرارداد خرید و فروش است؟ ⟦تصمیم⟧<br/>sale_branch" as sale_branch
  state "بررسی حقوقی<br/>legal_review" as legal_review
  state "نتیجه بررسی حقوقی ⟦تصمیم⟧<br/>legal_result" as legal_result
  state "اصلاح بندهای قرارداد<br/>clause_edit" as clause_edit
  state "ثبت رد و دلیل آن ⟦پایانی⟧<br/>contract_rejected" as contract_rejected
  state "نیاز به ویرایش بند دارد؟ ⟦تصمیم⟧<br/>clause_edit_decision" as clause_edit_decision
  state "آماده‌سازی برای امضا<br/>signature_prep" as signature_prep
  state "ارسال و پیگیری امضای طرفین<br/>signature_collect" as signature_collect
  state "امضاهای لازم کامل و معتبرند؟ ⟦تصمیم⟧<br/>signature_check" as signature_check
  state "پیگیری امضاهای باقی‌مانده ⟦خطا/حلقه⟧<br/>signature_followup" as signature_followup
  state "کد رهگیری درخواست شده است؟ ⟦تصمیم⟧<br/>tracking_decision" as tracking_decision
  state "اتمام قرارداد با امضا، بدون کد رهگیری ⟦پایانی⟧<br/>contract_done_no_tracking" as contract_done_no_tracking
  state "ارسال درخواست کد رهگیری<br/>tracking_request" as tracking_request
  state "کد رهگیری دریافت شده؟ ⟦تصمیم⟧<br/>tracking_check" as tracking_check
  state "ثبت خطا و پیگیری رفع مشکل ⟦خطا/حلقه⟧<br/>tracking_error" as tracking_error
  state "ثبت کد رهگیری و اتمام قرارداد ⟦پایانی⟧<br/>contract_done_with_tracking" as contract_done_with_tracking

  [*] --> contract_start
  contract_rejected --> [*]
  contract_done_no_tracking --> [*]
  contract_done_with_tracking --> [*]

  contract_start --> rent_info : انتخاب نوع قرارداد ▸ اجاره ⟦انتخابی⟧
  contract_start --> sale_info : انتخاب نوع قرارداد ▸ خرید و فروش ⟦انتخابی⟧
  rent_info --> output_choice : ثبت اطلاعات اجاره
  sale_info --> output_choice : ثبت اطلاعات خرید و فروش
  output_choice --> no_tracking : تعیین خروجی موردنیاز ▸ فقط امضا ⟦انتخابی⟧
  output_choice --> with_tracking : تعیین خروجی موردنیاز ▸ امضا و کد رهگیری ⟦انتخابی⟧
  no_tracking --> case_created : تشکیل پرونده خدمت ⟦خودکار⟧
  with_tracking --> case_created : تشکیل پرونده خدمت ⟦خودکار⟧
  case_created --> finance_check : ورود به بررسی شرایط مالی ⟦خودکار⟧
  finance_check --> payment_direct : انتخاب روش تسویه ▸ پرداخت مستقیم ⟦انتخابی⟧
  finance_check --> subscription_check : انتخاب روش تسویه ▸ اشتراک ⟦انتخابی⟧
  finance_check --> referral_check : انتخاب روش تسویه ▸ ریفرال یا معافیت ⟦انتخابی⟧
  finance_check --> finance_ok : انتخاب روش تسویه ▸ بدون نیاز به پرداخت ⟦انتخابی⟧
  payment_direct --> finance_ok : پرداخت موفق ⟦خودکار⟧
  payment_error --> finance_ok : پرداخت موفق ⟦خودکار⟧
  subscription_check --> finance_ok : پرداخت موفق ⟦خودکار⟧
  referral_check --> finance_ok : پرداخت موفق ⟦خودکار⟧
  payment_direct --> payment_error : ثبت خطا و پیگیری پرداخت ⟦خودکار⟧
  subscription_check --> payment_error : ثبت خطا و پیگیری پرداخت ⟦خودکار⟧
  referral_check --> payment_error : ثبت خطا و پیگیری پرداخت ⟦خودکار⟧
  payment_error --> payment_direct : تلاش مجدد پرداخت
  payment_error --> contract_rejected : انصراف از پرداخت و بستن پرونده
  subscription_check --> finance_ok : اشتراک معتبر است ⟦خودکار⟧
  subscription_check --> payment_direct : اشتراک معتبر نیست — هدایت به پرداخت مستقیم
  referral_check --> finance_ok : ریفرال یا معافیت تأیید شد
  referral_check --> payment_direct : ریفرال یا معافیت تأیید نشد — هدایت به پرداخت مستقیم
  finance_ok --> documents_review : بررسی مدارک قرارداد ⟦خودکار⟧
  documents_review --> documents_incomplete : اعلام مدارک موردنیاز
  documents_review --> documents_rejected : اعلام دلیل رد و درخواست اصلاح
  documents_incomplete --> documents_review : بارگذاری یا اصلاح مدارک
  documents_rejected --> documents_review : بارگذاری یا اصلاح مدارک
  documents_review --> documents_pending_queue : ارسال به صف بررسی کارشناس
  documents_pending_queue --> documents_review : ثبت نتیجه بررسی مدارک توسط کارشناس
  documents_review --> sale_branch : تأیید همه مدارک
  sale_branch --> legal_review : خرید و فروش — بررسی حقوقی ⟦خودکار⟧
  sale_branch --> clause_edit_decision : اجاره — تصمیم ویرایش بند ⟦خودکار⟧
  clause_edit_decision --> legal_review : نیاز به ویرایش بند دارد ▸ بله — ارجاع به بررسی حقوقی ⟦انتخابی⟧
  clause_edit_decision --> signature_prep : نیاز به ویرایش بند دارد ▸ خیر — آماده‌سازی امضا ⟦انتخابی⟧
  legal_review --> legal_result : آماده ثبت نتیجه بررسی حقوقی ⟦خودکار⟧
  legal_result --> signature_prep : تأیید بررسی حقوقی
  legal_result --> clause_edit : نیاز به اصلاح بند
  legal_result --> contract_rejected : رد قرارداد در بررسی حقوقی
  clause_edit --> legal_review : اصلاح بندهای قرارداد
  signature_prep --> signature_collect : ارسال و پیگیری امضای طرفین
  signature_collect --> signature_check : بررسی وضعیت امضاها
  signature_followup --> signature_check : بررسی وضعیت امضاها
  signature_check --> signature_followup : پیگیری امضاهای باقی‌مانده ⟦خودکار⟧
  signature_check --> tracking_decision : همه امضاها کامل و معتبر ⟦خودکار⟧
  tracking_decision --> contract_done_no_tracking : اتمام قرارداد بدون کد رهگیری ⟦خودکار⟧
  tracking_decision --> tracking_request : ارسال درخواست کد رهگیری ⟦خودکار⟧
  tracking_request --> tracking_check : تلاش مجدد برای کد رهگیری ⟦خودکار⟧
  tracking_check --> contract_done_with_tracking : کد رهگیری دریافت شد
  tracking_check --> tracking_error : ثبت خطا و پیگیری رفع مشکل
  tracking_error --> tracking_request : تلاش مجدد برای دریافت کد رهگیری
  tracking_error --> contract_rejected : انصراف از کد رهگیری و بستن پرونده

  note right of contract_start
    منبع حقیقت: workflow-definitions/contract.v1.json
    نسخه‌ای که پرونده با آن ساخته می‌شود قفل می‌گردد
  end note
```

---

## 08-workflow-listing

### گردش‌کار آگهی (listing v1)

بررسی مالی آگهی → تکمیل اطلاعات → بررسی کارشناس → انتشار/توقف/انقضا/بستن.

* فایل: [`08-workflow-listing.mmd`](./08-workflow-listing.mmd) — تولید خودکار از کد (`npm run diagrams`)

```mermaid
stateDiagram-v2
  direction TB
  state "شروع فرایند ثبت آگهی ⟦آغاز⟧<br/>listing_start" as listing_start
  state "بررسی شرایط مالی مختص آگهی<br/>listing_finance" as listing_finance
  state "تکمیل اطلاعات و مدارک آگهی<br/>listing_info" as listing_info
  state "بررسی آگهی توسط کارشناس<br/>listing_review" as listing_review
  state "نتیجه بررسی آگهی ⟦تصمیم⟧<br/>listing_result" as listing_result
  state "اعلام نقص یا علت رد ⟦خطا/حلقه⟧<br/>listing_needs_fix" as listing_needs_fix
  state "انتشار و مدیریت وضعیت آگهی<br/>listing_published" as listing_published
  state "توقف موقت انتشار<br/>listing_paused" as listing_paused
  state "انقضای آگهی ⟦پایانی⟧<br/>listing_expired" as listing_expired
  state "بسته‌شدن آگهی ⟦پایانی⟧<br/>listing_closed" as listing_closed

  [*] --> listing_start
  listing_expired --> [*]
  listing_closed --> [*]

  listing_start --> listing_finance : بررسی شرایط مالی آگهی ⟦خودکار⟧
  listing_finance --> listing_info : تأیید شرایط مالی (پرداخت، اشتراک یا معافیت)
  listing_info --> listing_review : تکمیل اطلاعات و مدارک آگهی
  listing_review --> listing_result : ثبت نتیجه بررسی کارشناس
  listing_result --> listing_needs_fix : اعلام نقص یا علت رد
  listing_needs_fix --> listing_info : اصلاح و ارسال مجدد آگهی
  listing_result --> listing_published : انتشار آگهی
  listing_published --> listing_paused : توقف موقت انتشار
  listing_paused --> listing_published : انتشار مجدد
  listing_published --> listing_expired : انقضای آگهی ⟦خودکار⟧
  listing_paused --> listing_expired : انقضای آگهی ⟦خودکار⟧
  listing_published --> listing_closed : بستن آگهی (معامله انجام شد یا لغو)
  listing_paused --> listing_closed : بستن آگهی (معامله انجام شد یا لغو)

  note right of listing_start
    منبع حقیقت: workflow-definitions/listing.v1.json
    نسخه‌ای که پرونده با آن ساخته می‌شود قفل می‌گردد
  end note
```

---

## 09-workflow-requirements

### گردش‌کار نیازمندی‌ها (requirements v1)

ثبت نیازمندی → سطح دسترسی → تطبیق با آگهی‌ها → برآورده‌شدن یا انقضا.

* فایل: [`09-workflow-requirements.mmd`](./09-workflow-requirements.mmd) — تولید خودکار از کد (`npm run diagrams`)

```mermaid
stateDiagram-v2
  direction TB
  state "ثبت نیازمندی ⟦آغاز⟧<br/>requirements_start" as requirements_start
  state "نمایش نیازمندی‌ها طبق دسترسی<br/>requirements_visible" as requirements_visible
  state "تطبیق با آگهی‌های موجود<br/>requirements_matching" as requirements_matching
  state "ارائه پیشنهادها<br/>requirements_matched" as requirements_matched
  state "نیازمندی تأمین شد ⟦پایانی⟧<br/>requirements_fulfilled" as requirements_fulfilled
  state "انقضای نیازمندی ⟦پایانی⟧<br/>requirements_expired" as requirements_expired
  state "لغو توسط متقاضی ⟦پایانی⟧<br/>requirements_cancelled" as requirements_cancelled

  [*] --> requirements_start
  requirements_fulfilled --> [*]
  requirements_expired --> [*]
  requirements_cancelled --> [*]

  requirements_start --> requirements_visible : تعیین سطح دسترسی نمایش ▸ عمومی ⟦انتخابی⟧
  requirements_start --> requirements_visible : تعیین سطح دسترسی نمایش ▸ فقط مشاوران املاک ⟦انتخابی⟧
  requirements_start --> requirements_visible : تعیین سطح دسترسی نمایش ▸ فقط کارکنان CRM ⟦انتخابی⟧
  requirements_visible --> requirements_matching : تطبیق با آگهی‌ها
  requirements_matching --> requirements_matched : ارائه پیشنهادهای تطبیق‌یافته
  requirements_matched --> requirements_visible : بازگشت به نمایش عمومی
  requirements_matched --> requirements_fulfilled : تأمین نیازمندی
  requirements_visible --> requirements_expired : انقضای نیازمندی ⟦خودکار⟧
  requirements_matched --> requirements_expired : انقضای نیازمندی ⟦خودکار⟧
  requirements_visible --> requirements_cancelled : لغو توسط متقاضی
  requirements_matched --> requirements_cancelled : لغو توسط متقاضی

  note right of requirements_start
    منبع حقیقت: workflow-definitions/requirements.v1.json
    نسخه‌ای که پرونده با آن ساخته می‌شود قفل می‌گردد
  end note
```

---

## 10-workflow-custom-service

### گردش‌کار سایر خدمات (custom_service v1)

قالب عمومی خدمت سفارشی: ثبت → بررسی مالی → بررسی کارشناس → بستن پرونده.

* فایل: [`10-workflow-custom-service.mmd`](./10-workflow-custom-service.mmd) — تولید خودکار از کد (`npm run diagrams`)

```mermaid
stateDiagram-v2
  direction TB
  state "شروع خدمت ⟦آغاز⟧<br/>service_start" as service_start
  state "تکمیل اطلاعات و مدارک خدمت<br/>service_details" as service_details
  state "بررسی شرایط مالی خدمت ⟦تصمیم⟧<br/>service_finance" as service_finance
  state "خطای مالی و پیگیری ⟦خطا/حلقه⟧<br/>service_finance_error" as service_finance_error
  state "اجرای مراحل اختصاصی خدمت<br/>service_execution" as service_execution
  state "بررسی و تأیید نتیجه<br/>service_review" as service_review
  state "اعلام نقص و درخواست اصلاح ⟦خطا/حلقه⟧<br/>service_needs_fix" as service_needs_fix
  state "تحویل نتیجه خدمت ⟦پایانی⟧<br/>service_delivered" as service_delivered
  state "لغو خدمت ⟦پایانی⟧<br/>service_cancelled" as service_cancelled

  [*] --> service_start
  service_delivered --> [*]
  service_cancelled --> [*]

  service_start --> service_details : تکمیل اطلاعات و مدارک خدمت
  service_details --> service_finance : بررسی شرایط مالی خدمت
  service_finance --> service_execution : تأیید شرایط مالی خدمت
  service_finance_error --> service_execution : تأیید شرایط مالی خدمت
  service_finance --> service_finance_error : ثبت خطای مالی و پیگیری
  service_execution --> service_review : اعلام نتیجه اجرای خدمت
  service_review --> service_delivered : تأیید نتیجه خدمت و تحویل
  service_review --> service_needs_fix : اعلام نقص و درخواست اصلاح
  service_needs_fix --> service_execution : اصلاح و اجرای مجدد
  service_details --> service_cancelled : لغو خدمت
  service_finance --> service_cancelled : لغو خدمت
  service_finance_error --> service_cancelled : لغو خدمت
  service_execution --> service_cancelled : لغو خدمت
  service_review --> service_cancelled : لغو خدمت
  service_needs_fix --> service_cancelled : لغو خدمت

  note right of service_start
    منبع حقیقت: workflow-definitions/custom_service.v1.json
    نسخه‌ای که پرونده با آن ساخته می‌شود قفل می‌گردد
  end note
```

---

## 11-guards-effects-map

### نگاشت گاردها و افکت‌ها

کدام گارد/افکت در کدام گردش‌کار استفاده شده و کدام کلیدهای رجیستری هنوز مصرف‌کننده ندارند.

* فایل: [`11-guards-effects-map.mmd`](./11-guards-effects-map.mmd) — تولید خودکار از کد (`npm run diagrams`)

```mermaid
mindmap
  root((رجیستری دامنه<br/>32 گارد<br/>25 افکت))
    فرایند قرارداد — contract v1
      گاردها
        all_documents_approved
        attempts_below_limit
        contract_details_complete
        contract_document_ready
        contract_is_rent
        contract_is_sale
        has_clause_revision
        has_reason
        legal_approved
        legal_needs_edit
        legal_rejected
        payment_result_is
        payment_succeeded
        referral_approved
        signatures_complete
        subscription_valid
        tracking_code_received
        tracking_not_required
        tracking_required
      افکت‌ها
        assign_case_code
        bump_clause_version
        close_case
        consume_referral
        create_followup_task
        emit_invoice
        generate_contract_document
        increment_attempt
        notify_parties
        queue_for_expert
        record_event
        record_legal_review
        record_tracking_code
        record_tracking_error
        request_tracking_code
        send_for_signature
        set_requires_tracking
    قالب سایر خدمات — custom_service v1
      گاردها
        has_reason
        service_approved
        service_finance_ok
      افکت‌ها
        close_case
        create_followup_task
        emit_invoice
        notify_parties
        record_event
    فرایند آگهی — listing v1
      گاردها
        has_reason
        listing_approved
        listing_data_complete
        listing_expired
        listing_finance_ok
      افکت‌ها
        close_case
        create_followup_task
        emit_invoice
        notify_parties
        publish_listing
        queue_for_expert
        record_event
        unpublish_listing
    فرایند نیازمندی‌ها — requirements v1
      گاردها
        has_reason
        matches_found
        requirement_expired
      افکت‌ها
        close_case
        create_followup_task
        notify_parties
        record_event
        set_access_level
        set_requirement_status
    وضعیت رجیستری
      گاردهای بدون مصرف (5)
        documents_incomplete
        documents_pending
        documents_rejected
        report_decision
        settlement_method_is
      افکت‌های بدون مصرف (4)
        emit_webhook
        set_due
        set_priority
        update_followup_task
      کلیدهای ناشناس در تعریف‌ها (0)
```

---

## 12-sync-push

### سینک Push (اینگست)

مسیر `POST /api/v1/ingest/[entity]`: احراز هویت دوگانه (کلید + HMAC)، idempotency و پردازش آیتم‌به‌آیتم.

* فایل: [`12-sync-push.mmd`](./12-sync-push.mmd) — نگهداری دستی

```mermaid
sequenceDiagram
  autonumber
  participant M as سرور اصلی کارفرما
  participant R as POST /api/v1/ingest/[entity]
  participant SY as services/sync.ts
  participant PL as repos/platform (sync_log، idempotency)
  participant CS as CaseService / repos
  participant DB as SQLite

  M->>R: POST با هدرهای X-Sync-Key، X-Signature، X-Idempotency-Key، X-Sync-Source
  Note over M,R: بدنه = {"source":"main-server","items":[...]}<br/>امضا = sha256=HMAC-SHA256(SYNC_SECRET, rawBody)

  R->>R: ensureMigrated + اعتبارسنجی نام موجودیت
  alt موجودیت نامعتبر
    R-->>M: 404 SYNC_INVALID — مقادیر مجاز users/contracts/listings/requirements
  end

  R->>SY: checkIngestAuth(headers, rawBody)
  SY->>SY: مقایسه کلید با SYNC_API_KEY
  SY->>SY: verifySignature با timingSafeEqual
  alt SYNC_API_KEY تنظیم نشده
    SY-->>R: 503 — سینک پیکربندی نشده
    R-->>M: 503
  else کلید یا امضا نامعتبر
    SY-->>R: 401 — کلید/امضای نامعتبر
    R-->>M: 401
  else معتبر
    SY-->>R: ok

    opt کلید idempotency ارسال شده
      R->>PL: getIdempotentResponse(key)
      PL->>DB: SELECT از idempotency_keys (TTL ۴۸ ساعت)
      alt پاسخ قبلی موجود است
        PL-->>R: پاسخ ذخیره‌شده
        R-->>M: 200 {ok:true, replayed:true, …} — بدون اثر دوباره
      end
    end

    R->>SY: parseBody(rawBody) سپس ingest(entity, body, headers)
    SY->>PL: ثبت sync_log (entity، source، تعداد آیتم‌ها)

    loop برای هر آیتم (خطای یک رکورد بقیه را متوقف نمی‌کند)
      SY->>SY: نرمال‌سازی camelCase/snake_case و اعتبارسنجی فیلدها
      alt entity = users
        SY->>CS: upsert کاربر با کلید یکتا (source, external_id)
      else entity = contracts
        SY->>CS: upsert کاربر طرفین + upsertSyncedCase + جزئیات قرارداد
        CS->>DB: ساخت/به‌روزرسانی پرونده با نسخه گردش‌کار قفل‌شده
      else entity = listings
        SY->>CS: upsert پرونده آگهی + رکورد listings
      else entity = requirements
        SY->>CS: upsert پرونده نیازمندی + رکورد requirements
      end
      CS-->>SY: action = created / updated / unchanged / rejected
      SY->>PL: ثبت sync_item_results
    end

    SY->>PL: writeAudit + به‌روزرسانی خلاصه sync_log
    opt کلید idempotency ارسال شده
      SY->>PL: saveIdempotentResponse(key, نتیجه)
    end
    SY-->>R: IngestResult
    R-->>M: 200 {ok, entity, summary, items, syncLogId}
  end

  Note over M,DB: اگر گذاری triggerEvent داشته باشد، رویداد بیرونی می‌تواند پرونده را پیش ببرد (origin=partner/either)
```

---

## 13-sync-pull-webhook

### سینک Pull و Webhook خروجی

کارهای زمان‌بندی‌شده: واکشی با کرسور از سرور اصلی و ارسال وب‌هوک با backoff نمایی (سقف ۵ تلاش).

* فایل: [`13-sync-pull-webhook.mmd`](./13-sync-pull-webhook.mmd) — نگهداری دستی

```mermaid
sequenceDiagram
  autonumber
  participant CR as زمان‌بند سرور (cron)
  participant JP as POST /api/v1/jobs/pull
  participant JW as POST /api/v1/jobs/dispatch-webhooks
  participant SY as services/sync.ts
  participant M as سرور اصلی کارفرما
  participant DB as SQLite (pull_cursors، outbound_webhooks)

  rect rgb(238, 246, 255)
    Note over CR,DB: کانال Pull — CRM از سرور اصلی می‌خواند
    CR->>JP: POST هر ۵ تا ۱۵ دقیقه (با کلید سینک)
    JP->>JP: بررسی مجوز (کلید/امضا) و SYNC_PULL_ENABLED
    loop برای هر موجودیت users · contracts · listings · requirements
      JP->>SY: pullOnce(entity)
      SY->>DB: getPullCursor(entity) — آخرین زمان واکشی
      SY->>M: GET {SYNC_PULL_URL}/{entity}?since=… با هدر X-Sync-Key
      alt پاسخ موفق
        M-->>SY: {items:[…]}
        SY->>SY: ingest(entity, payload, {source:"pull"}) — همان مسیر Push
        SY->>DB: setPullCursor(entity, now)
        SY-->>JP: ok + خلاصه
      else خطا یا پاسخ ناموفق
        M-->>SY: HTTP 4xx/5xx یا خطای شبکه
        SY-->>JP: ok=false + پیام فارسی (کرسر دست‌نخورده می‌ماند)
      end
    end
    JP-->>CR: جمع‌بندی همه موجودیت‌ها
  end

  rect rgb(240, 253, 244)
    Note over CR,DB: کانال Webhook خروجی — CRM رویدادها را می‌فرستد
    Note over DB: صف از افکت emit_webhook در گذارها پر می‌شود<br/>(بسته‌شدن پرونده، انتشار آگهی، پرداخت، کد رهگیری)
    CR->>JW: POST هر ۵ دقیقه
    JW->>SY: dispatchDueWebhooks(limit = 20)
    SY->>DB: dueWebhooks — status=pending و next_attempt_at سررسیده
    loop برای هر وب‌هوک سررسیده
      SY->>SY: انتخاب آدرس — رکورد → تنظیمات پنل (sync.webhookUrl) → WEBHOOK_TARGET_URL
      SY->>SY: signOutboundPayload → sha256=HMAC(WEBHOOK_SECRET یا SYNC_SECRET)
      SY->>M: POST {event, data} با هدرهای X-Webhook-Event، X-Webhook-Signature، X-Webhook-Attempt
      alt پاسخ 2xx
        M-->>SY: ok
        SY->>DB: markWebhook(sent)
      else پاسخ ناموفق یا خطای شبکه
        M-->>SY: HTTP xxx / timeout
        SY->>DB: markWebhook(failed, attempts+1, backoff = 2^attempts دقیقه، سقف ۲۴ ساعت)
        Note over SY,DB: پس از ۵ تلاش ناموفق → dead (قابل تلاش دستی از پنل «وضعیت سینک»)
      end
    end
    JW-->>CR: نتیجه ارسال‌ها
  end

  Note over CR,DB: هر دو مسیر در sync_log و audit_log ثبت می‌شوند و در پنل «وضعیت سینک» قابل پایش‌اند
```

---

## 14-auth-session

### احراز هویت، نشست و RBAC

ورود (scrypt/SSO)، کوکی HttpOnly، مسیر بدون کوکی با `X-Session-Ticket`، CSRF بدون‌حالت و ماتریس دسترسی.

* فایل: [`14-auth-session.mmd`](./14-auth-session.mmd) — نگهداری دستی

```mermaid
flowchart TD
  classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d;
  classDef err fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d;
  classDef proc fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a;
  classDef dec fill:#fef3c7,stroke:#b45309,color:#78350f;
  classDef sec fill:#fce7f3,stroke:#be185d,color:#831843;

  subgraph LOGIN["ورود — /login"]
    direction TB
    L0(["کارمند نام کاربری و رمز را می‌فرستد"]):::proc
    L1{"توکن CSRF فرم معتبر است؟<br/>nonce.issuedAt.HMAC با SESSION_SECRET"}:::dec
    L1 -->|نه| LE1["«اعتبار فرم منقضی شده است»<br/>+ توکن تازه در پاسخ"]:::err
    L1 -->|بله| L2{"توکن SSO ارسال شده<br/>و SSO_ENABLED=true ؟"}:::dec
    L2 -->|بله| L3["verifySsoToken (JWT HS256)<br/>یافتن کارمند با username یا sso_subject"]:::sec
    L2 -->|نه| L4["verifyPassword — scrypt با نمک اختصاصی"]:::sec
    L3 --> L5{"کارمند یافت شد و active است؟"}:::dec
    L4 --> L5
    L5 -->|نه| LE2["«نام کاربری یا رمز عبور نادرست است»<br/>/ «حساب شما غیرفعال است»"]:::err
    L5 -->|بله| L6["signSessionToken — JWT با SESSION_SECRET (۱۲ ساعت)<br/>createSession — ذخیره token_hash در جدول sessions<br/>touchStaffLogin + writeAudit(auth.login)"]:::ok
    L6 --> L7["کوکی crm_session<br/>HttpOnly · SameSite=Lax (یا None+Secure+Partitioned در iframe)"]:::ok
    L6 --> L8["بازگرداندن ticket به کلاینت<br/>session-bridge: حافظه + ?t=… + localStorage"]:::ok
  end

  subgraph REQ["هر درخواست بعدی"]
    direction TB
    R0(["درخواست مرورگر به /panel/**"]):::proc
    R1{"کوکی نشست حاضر است؟"}:::dec
    R1 -->|بله| R4
    R1 -->|نه — مسدود در iframe| R2{"پروکسی: پارامتر ?t=…<br/>یا هدر X-Session-Ticket / Bearer ؟"}:::dec
    R2 -->|بله| R3["src/proxy.ts → تبدیل به هدر X-Session-Ticket"]:::sec
    R2 -->|نه| R5{"LOCAL_DEMO_MODE=true ؟"}:::dec
    R5 -->|بله — فقط ماشین توسعه| R6["نشست نمایشی با نقش مدیر<br/>(بدون ردیف در دیتابیس) + نشان هشدار در پنل"]:::err
    R5 -->|نه| R7["redirect به /login"]:::err
    R3 --> R4["sessionFromToken<br/>۱) verifySessionToken (JWT) ۲) یافتن ردیف sessions با token_hash<br/>۳) revoked_at و expires_at ۴) staff.active"]:::sec
    R4 --> R8{"نشست معتبر است؟"}:::dec
    R8 -->|نه| R7
    R8 -->|بله| R9["CurrentSession {staff, role}"]:::ok
  end

  subgraph GUARD["محافظت هر اقدام"]
    direction TB
    G1["assertCsrf / assertCsrfHeader<br/>روی همه Server Actionها و فرم‌ها"]:::sec
    G2["requirePermission → can(role, permission)<br/>ماتریس RBAC: staff در برابر admin"]:::sec
    G3["writeAudit — ثبت در audit_log<br/>بازیابی در پنل «لاگ حسابرسی»"]:::ok
    G1 --> G2 --> G3
  end

  subgraph OUT["خروج — /logout"]
    direction TB
    O1["revokeSession برای کوکی و ticket هر دو<br/>حذف کوکی + redirect به /login"]:::ok
  end

  L7 --> R0
  L8 --> R0
  R9 --> G1
  R6 --> G1
  G3 --> BIZ(["اجرای عملیات: گذار پرونده، بررسی مدرک، پرداخت، سینک…"]):::proc
  BIZ --> O1

  subgraph ROLES["ماتریس دسترسی (src/auth/rbac.ts)"]
    direction LR
    RS["نقش staff<br/>case.view/create/transition/assign · document.review<br/>payment.record · tracking.manage · listing.manage<br/>requirement.manage · user.view · task.manage · report.view"]:::proc
    RA["فقط admin<br/>case.abort/close · legal.review · payment.abort · tracking.abort<br/>referral.manage · service.manage · workflow.manage<br/>staff.manage · settings.manage · sync.manage · audit.view"]:::sec
  end
  G2 -.->|"منبع حقیقت"| ROLES
```

---

## 15-panel-sitemap

### نقشه پنل و API

صفحات `/panel/**` در سه گروه کارتابل/پرونده‌ها/مدیریت، Server Actionهای هر صفحه و endpoint های HTTP.

* فایل: [`15-panel-sitemap.mmd`](./15-panel-sitemap.mmd) — نگهداری دستی

```mermaid
flowchart LR
  classDef page fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a;
  classDef admin fill:#fce7f3,stroke:#be185d,color:#831843;
  classDef action fill:#dcfce7,stroke:#15803d,color:#14532d;
  classDef api fill:#fef3c7,stroke:#b45309,color:#78350f;
  classDef svc fill:#ede9fe,stroke:#6d28d9,color:#4c1d95;

  Login["/login<br/>ورود کارکنان + SSO اختیاری"]:::page
  Home["/ → هدایت به /panel یا /login"]:::page

  subgraph KART["گروه «کارتابل»"]
    direction TB
    Dash["/panel — داشبورد<br/>صف کارشناس، آمار، سررسیدها"]:::page
    Tasks["/panel/tasks — وظایف من"]:::page
  end

  subgraph CASES["گروه «پرونده‌ها»"]
    direction TB
    Cases["/panel/cases — همه پرونده‌ها<br/>فیلتر خدمت: contract/listing/requirements/custom"]:::page
    CaseDetail["/panel/cases/[id] — جزئیات پرونده<br/>تایم‌لاین، مدارک، امضا، مالی، رهگیری، وظایف، اقدام‌ها"]:::page
    Listings["/panel/listings — آگهی‌ها"]:::page
    Reqs["/panel/requirements — نیازمندی‌ها و تطبیق‌ها"]:::page
    Users["/panel/users — کاربران سینک‌شده"]:::page
    UserDetail["/panel/users/[id] — پرونده کاربر"]:::page
  end

  subgraph ADMIN["گروه «مدیریت» — فقط admin"]
    direction TB
    Services["/panel/services — خدمات و قیمت‌ها"]:::admin
    Workflows["/panel/workflows — گردش‌کارها<br/>import نسخه تازه + activate"]:::admin
    Staff["/panel/staff — کارمندان"]:::admin
    SyncPage["/panel/sync — وضعیت سینک<br/>لاگ‌ها، وب‌هوک‌ها، کرسورها، تنظیمات"]:::admin
    Audit["/panel/audit — لاگ حسابرسی"]:::admin
  end

  subgraph ACT["Server Actionها"]
    direction TB
    ALogin["login/actions.ts<br/>loginAction · logoutAction · bootstrapAdminAction"]:::action
    ACases["panel/cases/actions.ts<br/>createCase · transition · saveContract · reviewDocument<br/>markSignature · saveListing · saveRequirement · computeMatches<br/>addTask · completeTask · reassignCase"]:::action
    AServices["panel/services/actions.ts<br/>saveService · toggleService"]:::action
    AWorkflows["panel/workflows/actions.ts<br/>importWorkflow · activateWorkflow"]:::action
    AStaff["panel/staff/actions.ts<br/>createStaff · updateStaff · resetPassword · revokeSessions"]:::action
    ASync["panel/sync/actions.ts<br/>pullNow · dispatchWebhooks · saveSyncSettings<br/>seedDefinitions · retryWebhook · purgeDeadWebhooks"]:::action
  end

  subgraph API["APIهای HTTP — src/app/api"]
    direction TB
    ApiHealth["GET /api/health"]:::api
    ApiSession["GET|DELETE /api/auth/session"]:::api
    ApiIngest["POST|GET /api/v1/ingest/[entity]"]:::api
    ApiPull["POST|GET /api/v1/jobs/pull"]:::api
    ApiHooks["POST|GET /api/v1/jobs/dispatch-webhooks"]:::api
  end

  SVC["لایه سرویس<br/>CaseService · sync.ts · definitions.ts · auth"]:::svc
  DB[("SQLite — /data/crm.db")]:::svc
  Main["سرور اصلی کارفرما"]:::api

  Login --> Dash
  Home --> Dash
  Dash --> Cases
  Dash --> Tasks
  Cases --> CaseDetail
  Users --> UserDetail
  CaseDetail --> Listings
  CaseDetail --> Reqs

  Dash -.-> ACT
  Cases -.-> ACases
  CaseDetail -.-> ACases
  Listings -.-> ACases
  Reqs -.-> ACases
  Services -.-> AServices
  Workflows -.-> AWorkflows
  Staff -.-> AStaff
  SyncPage -.-> ASync
  Login -.-> ALogin

  ACT --> SVC
  API --> SVC
  SVC --> DB
  ApiIngest <-->|"Push"| Main
  ApiPull -->|"Pull"| Main
  ApiHooks -->|"Webhook"| Main
```

---

## 16-deployment

### استقرار با داکر

ایمیج چندمرحله‌ای، والیوم `crm-data` (SQLite)، معکوس‌پروکسی، crontab و متغیرهای محیطی حساس.

* فایل: [`16-deployment.mmd`](./16-deployment.mmd) — نگهداری دستی

```mermaid
flowchart TB
  classDef host fill:#f1f5f9,stroke:#475569,color:#0f172a;
  classDef cont fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a;
  classDef data fill:#fef3c7,stroke:#b45309,color:#78350f;
  classDef ext fill:#dcfce7,stroke:#15803d,color:#14532d;
  classDef warn fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d;

  Client["مرورگر کارشناس/مدیر"]:::ext
  MainSrv["سرور اصلی کارفرما<br/>(Push / Pull / Webhook)"]:::ext

  subgraph HOST["سرور میزبان (Linux + Docker)"]
    direction TB
    NGX["Nginx / معکوس‌پروکسی<br/>HTTPS + دامنه اختصاصی (crm.example.com)<br/>CSP frame-ancestors در next.config.ts"]:::host
    Cron["crontab میزبان<br/>هر دقیقه: dispatch-webhooks<br/>هر ۱۵ دقیقه: jobs/pull (در صورت فعال‌بودن Pull)"]:::host

    subgraph COMPOSE["docker-compose.yml — سرویس crm"]
      direction TB
      subgraph IMG["ایمیج crm-realestate:latest (node:24-alpine، چندمرحله‌ای)"]
        direction TB
        Tini["tini به‌عنوان ENTRYPOINT<br/>کاربر غیرریشه nextjs (uid 1001)"]:::cont
        Boot["CMD: scripts/migrate.mjs → scripts/seed.mjs → node server.js"]:::cont
        Next["Next.js standalone (output: standalone)<br/>HOSTNAME=0.0.0.0 · PORT=3000 · TZ=Asia/Tehran"]:::cont
        Assets[".next/static · public · migrations<br/>workflow-definitions · src/data · scripts"]:::cont
      end
      Health["HEALTHCHECK هر ۳۰ ثانیه<br/>GET /api/health"]:::cont
    end

    Vol[("والیوم crm-data → /data<br/>crm.db + WAL (SQLite داخلی Node)<br/>پشتیبان‌گیری = کپی همین فایل")]:::data
    Env[".env میزبان<br/>SESSION_SECRET (الزامی) · SYNC_API_KEY · SYNC_SECRET<br/>SYNC_PULL_URL · WEBHOOK_TARGET_URL · WEBHOOK_SECRET<br/>SSO_* · PAYMENT/TRACKING/NOTIFICATION_PROVIDER<br/>LOCAL_DEMO_MODE=false (صریح در compose)"]:::data
  end

  Client -->|"HTTPS"| NGX
  NGX -->|"proxy_pass → :3000"| Next
  MainSrv -->|"POST /api/v1/ingest/* با HMAC"| NGX
  Next -->|"GET {SYNC_PULL_URL}/{entity}?since=…"| MainSrv
  Next -->|"POST وب‌هوک با X-Webhook-Signature"| MainSrv
  Cron -->|"curl -X POST با X-Sync-Key روی 127.0.0.1:3000"| Next
  Boot --> Tini
  Next --> Vol
  Boot -->|"مهاجرت + seed تعریف‌ها و خدمات در اولین اجرا"| Vol
  Env -->|"environment:"| Next
  Health -.->|"بررسی زنده‌بودن"| Next

  Note["نکته امنیتی: LOCAL_DEMO_MODE روی سرور باید false بماند<br/>وگرنه پنل بدون ورود با نقش مدیر باز می‌شود"]:::warn
  Env -.-> Note
```

---

## نکته‌ها

* اگر دیاگرام تولیدی با کد هم‌خوان نباشد، `npm run diagrams:check` در CI شکست می‌خورد.
* برای ویرایش گردش‌کارها فقط `workflow-definitions/*.json` را تغییر دهید (یا از پنل «گردش‌کارها» نسخه تازه وارد کنید) و سپس `npm run diagrams` را اجرا کنید.
* فلوچارت تودرتو و کامل همه گردش‌کارها در `docs/superpowers/specs/2026-10-13-crm-flowchart.mmd` قرار دارد (`npm run flowchart`).
