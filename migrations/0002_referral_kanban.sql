-- ══════════════════════════════════════════════════════════════════
-- کانبان ارجاع درون‌سازمانی — واحدهای سازمانی، وضعیت کانبان و تاریخچه ارجاع
-- ستون‌های کانبان: ارجاع به همکار/واحد، تشخیص واحد، ثبت تاریخچه و مسیر ارجاع.
-- ══════════════════════════════════════════════════════════════════

-- واحد سازمانی و عنوان شغلی کارمند (برای تشخیص واحد مقصد در ارجاع به همکار)
ALTER TABLE staff ADD COLUMN org_unit TEXT;
ALTER TABLE staff ADD COLUMN title TEXT;

-- کاتالوگ واحدهای سازمانی (ستون‌های کانبان)
CREATE TABLE IF NOT EXISTS org_units (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- وضعیت کانبان پرونده در درون یک واحد
-- new=تازه‌وارد، in_review=در حال بررسی، waiting_info=منتظر اطلاعات،
-- returned_correction=برگشت برای اصلاح، done=انجام‌شده
ALTER TABLE cases ADD COLUMN kanban_status TEXT NOT NULL DEFAULT 'new'
  CHECK (kanban_status IN ('new', 'in_review', 'waiting_info', 'returned_correction', 'done'));

-- تاریخچه ارجاع‌ها — مسیر ارجاع‌دهنده → گیرنده
CREATE TABLE IF NOT EXISTS referrals (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  from_staff_id TEXT,
  from_unit     TEXT,
  to_staff_id   TEXT,
  to_unit       TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('colleague', 'unit')),
  reason        TEXT,
  service_key   TEXT,
  service_name  TEXT,
  depth         INTEGER NOT NULL DEFAULT 1,
  at            TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referrals_case ON referrals(case_id, at);
