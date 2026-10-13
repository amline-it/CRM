-- ══════════════════════════════════════════════════════════════════
-- عملیات کانبان، گفت‌وگوی داخلی، منشن، ارجاع کامل و صندوق اعلان داخلی
--
-- @foreign-keys-off
--   این مهاجرت جدول `cases` را برای افزودن وضعیت جدید «لغوشده» بازنویسی می‌کند.
--   SQLite امکان DROP/ALTER محدودیت CHECK را نمی‌دهد، پس الگوی استاندارد «ساخت
--   جدول تازه + کپی داده» اجرا می‌شود. چون جدول `cases` والدِ کلیدهای خارجی است،
--   موتور مهاجرت (src/db/migrate.ts) با دیدن دستور بالا موقتاً
--   `PRAGMA foreign_keys=OFF` را بیرون از تراکنش روشن می‌کند، مهاجرت را در یک
--   تراکنش اتمیک اجرا می‌کند و پیش از commit با `PRAGMA foreign_key_check`
--   سلامت ارجاع‌ها را می‌سنجد (در صورت خطا: rollback کامل بدون تغییر داده).
--   داده‌ای حذف نمی‌شود؛ فقط کپی و جایگزینی ساختار.
-- ══════════════════════════════════════════════════════════════════

-- ── ۱) بازنویسی جدول پرونده: افزودن وضعیت کانبان «لغوشده» ──────────
CREATE TABLE cases_new (
  id                 TEXT PRIMARY KEY,
  code               TEXT UNIQUE,
  external_id        TEXT,
  source             TEXT,
  title              TEXT,
  service_key        TEXT NOT NULL,
  workflow_key       TEXT NOT NULL,
  workflow_version   INTEGER NOT NULL,
  state              TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  outcome            TEXT,
  priority           TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  owner_user_id      TEXT,
  agent_user_id      TEXT,
  assigned_staff_id  TEXT,
  kanban_status      TEXT NOT NULL DEFAULT 'new'
                     CHECK (kanban_status IN ('new', 'in_review', 'waiting_info', 'returned_correction', 'done', 'cancelled')),
  due_at             TEXT,
  requires_tracking  INTEGER NOT NULL DEFAULT 0,
  access_level       TEXT,
  queue              TEXT,
  attempts_payment   INTEGER NOT NULL DEFAULT 0,
  attempts_tracking  INTEGER NOT NULL DEFAULT 0,
  meta               TEXT NOT NULL DEFAULT '{}',
  opened_at          TEXT NOT NULL,
  closed_at          TEXT,
  last_transition_at TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (source, external_id)
);

INSERT INTO cases_new (
  id, code, external_id, source, title, service_key, workflow_key, workflow_version, state, status, outcome,
  priority, owner_user_id, agent_user_id, assigned_staff_id, kanban_status, due_at, requires_tracking, access_level,
  queue, attempts_payment, attempts_tracking, meta, opened_at, closed_at, last_transition_at, created_at, updated_at
)
SELECT
  id, code, external_id, source, title, service_key, workflow_key, workflow_version, state, status, outcome,
  priority, owner_user_id, agent_user_id, assigned_staff_id,
  CASE WHEN kanban_status IS NULL THEN 'new' ELSE kanban_status END,
  due_at, requires_tracking, access_level,
  queue, attempts_payment, attempts_tracking, meta, opened_at, closed_at, last_transition_at, created_at, updated_at
FROM cases;

DROP TABLE cases;
ALTER TABLE cases_new RENAME TO cases;

CREATE INDEX IF NOT EXISTS idx_cases_state ON cases(state, status);
CREATE INDEX IF NOT EXISTS idx_cases_staff ON cases(assigned_staff_id, status);
CREATE INDEX IF NOT EXISTS idx_cases_service ON cases(service_key);
CREATE INDEX IF NOT EXISTS idx_cases_queue ON cases(queue);
CREATE INDEX IF NOT EXISTS idx_cases_kanban ON cases(kanban_status, status);
CREATE INDEX IF NOT EXISTS idx_cases_due ON cases(due_at, status);

-- ── ۲) غنی‌سازی تاریخچه ارجاع (بدون بازنویسی سابقه قبلی) ────────────
-- actor_*  = عامل ارجاع‌دهنده (کارمندی که دکمه ارجاع را زده)
-- from_staff_id = مسئول قبلی عملیات (ممکن است خالی باشد: صف واحد)
ALTER TABLE referrals ADD COLUMN entity_type TEXT;
ALTER TABLE referrals ADD COLUMN actor_type TEXT;
ALTER TABLE referrals ADD COLUMN actor_id TEXT;
ALTER TABLE referrals ADD COLUMN actor_name TEXT;
ALTER TABLE referrals ADD COLUMN description TEXT;
ALTER TABLE referrals ADD COLUMN expected_output TEXT;
ALTER TABLE referrals ADD COLUMN priority TEXT;
ALTER TABLE referrals ADD COLUMN due_at TEXT;
ALTER TABLE referrals ADD COLUMN status_before TEXT;
ALTER TABLE referrals ADD COLUMN status_after TEXT;
ALTER TABLE referrals ADD COLUMN result TEXT;
ALTER TABLE referrals ADD COLUMN note TEXT;
ALTER TABLE referrals ADD COLUMN outcome_note TEXT;
ALTER TABLE referrals ADD COLUMN idempotency_key TEXT;
ALTER TABLE referrals ADD COLUMN updated_at TEXT;

-- جلوگیری از ثبت ارجاع تکراری در درخواست تکراری (idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_idem
  ON referrals(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_to_staff ON referrals(to_staff_id, at);
CREATE INDEX IF NOT EXISTS idx_referrals_to_unit ON referrals(to_unit, at);
CREATE INDEX IF NOT EXISTS idx_referrals_actor ON referrals(actor_id, at);

-- ── ۳) گفت‌وگوی داخلی پرونده (جدا از پیام‌های مشتری و رویدادهای سیستمی) ──
-- این پیام‌ها هرگز در API سینک، وب‌هوک خروجی یا اعلان مشتری ظاهر نمی‌شوند.
CREATE TABLE IF NOT EXISTS case_messages (
  id               TEXT PRIMARY KEY,
  case_id          TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  author_staff_id  TEXT,
  author_name      TEXT,
  body             TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  edited_at        TEXT,
  deleted_at       TEXT,
  deleted_by       TEXT,
  meta             TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_case_messages_case ON case_messages(case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_case_messages_author ON case_messages(author_staff_id, created_at);

-- منشن همکاران با @ در گفت‌وگوی داخلی (منشن مسئولیت را منتقل نمی‌کند)
CREATE TABLE IF NOT EXISTS case_message_mentions (
  id                 TEXT PRIMARY KEY,
  message_id         TEXT NOT NULL REFERENCES case_messages(id) ON DELETE CASCADE,
  case_id            TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  mentioned_staff_id TEXT NOT NULL,
  notified           INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  UNIQUE (message_id, mentioned_staff_id)
);
CREATE INDEX IF NOT EXISTS idx_mentions_staff ON case_message_mentions(mentioned_staff_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mentions_case ON case_message_mentions(case_id, created_at);

-- آخرین زمان خواندن گفت‌وگوی هر پرونده توسط هر کارمند (شمارنده پیام جدید)
CREATE TABLE IF NOT EXISTS case_conversation_reads (
  case_id      TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  staff_id     TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (case_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_conv_reads_staff ON case_conversation_reads(staff_id, last_read_at);

-- ── ۴) صندوق اعلان داخلی (توسعه همان جدول notifications) ───────────
-- to_staff_id = گیرنده داخلی (کارمند) · channel='inapp' · status='sent'
ALTER TABLE notifications ADD COLUMN to_staff_id TEXT;
ALTER TABLE notifications ADD COLUMN kind TEXT;
ALTER TABLE notifications ADD COLUMN link TEXT;
ALTER TABLE notifications ADD COLUMN read_at TEXT;
ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_staff ON notifications(to_staff_id, read_at, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_kind ON notifications(to_staff_id, kind, created_at);
