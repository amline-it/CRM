-- ════════════════════════════════════════════════════════════════════
-- CRM املاک — اسکیمای پایه (SQLite)
-- همه تاریخ‌ها ISO-8601 UTC هستند؛ نمایش جلالی در لایه UI انجام می‌شود.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- ── تنظیمات و پیکربندی ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ── کارمندان/مدیران پنل (تنها کاربران دارای ورود) ─────────────────
CREATE TABLE IF NOT EXISTS staff (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('staff', 'admin')),
  active        INTEGER NOT NULL DEFAULT 1,
  sso_subject   TEXT UNIQUE,
  last_login_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  staff_id   TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_staff ON sessions(staff_id);

-- ── کاربران سینک‌شده از سرور اصلی (بدون ورود به پنل) ───────────────
CREATE TABLE IF NOT EXISTS users (
  id               TEXT PRIMARY KEY,
  external_id      TEXT,
  source           TEXT,
  full_name        TEXT NOT NULL,
  national_id      TEXT,
  mobile           TEXT,
  email            TEXT,
  user_type        TEXT NOT NULL DEFAULT 'normal' CHECK (user_type IN ('normal', 'agent')),
  agent_license_no TEXT,
  city             TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  deleted          INTEGER NOT NULL DEFAULT 0,
  payload_hash     TEXT,
  raw              TEXT,
  synced_at        TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);
CREATE INDEX IF NOT EXISTS idx_users_type ON users(user_type, deleted);

-- ── خدمات قابل ارائه ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id                    TEXT PRIMARY KEY,
  key                   TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  category              TEXT NOT NULL,
  description           TEXT,
  price                 INTEGER NOT NULL DEFAULT 0,
  requires_subscription INTEGER NOT NULL DEFAULT 0,
  requires_referral     INTEGER NOT NULL DEFAULT 0,
  workflow_key          TEXT NOT NULL,
  required_documents    TEXT NOT NULL DEFAULT '[]',
  active                INTEGER NOT NULL DEFAULT 1,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

-- ── پرونده خدمت ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cases (
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
CREATE INDEX IF NOT EXISTS idx_cases_state ON cases(state, status);
CREATE INDEX IF NOT EXISTS idx_cases_staff ON cases(assigned_staff_id, status);
CREATE INDEX IF NOT EXISTS idx_cases_service ON cases(service_key);
CREATE INDEX IF NOT EXISTS idx_cases_queue ON cases(queue);

CREATE TABLE IF NOT EXISTS case_transitions (
  id              TEXT PRIMARY KEY,
  case_id         TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  from_state      TEXT NOT NULL,
  to_state        TEXT NOT NULL,
  transition_key  TEXT NOT NULL,
  transition_name TEXT NOT NULL,
  option          TEXT,
  actor_type      TEXT NOT NULL,
  actor_id        TEXT,
  actor_name      TEXT,
  reason          TEXT,
  payload         TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT UNIQUE,
  at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transitions_case ON case_transitions(case_id, at);

CREATE TABLE IF NOT EXISTS timeline_events (
  id         TEXT PRIMARY KEY,
  case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'external')),
  actor_id   TEXT,
  actor_name TEXT,
  at         TEXT NOT NULL,
  meta       TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_timeline_case ON timeline_events(case_id, at);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  case_id     TEXT REFERENCES cases(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  priority    TEXT NOT NULL DEFAULT 'normal',
  assignee_id TEXT,
  due_at      TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  result_note TEXT,
  created_by  TEXT,
  dedupe_key  TEXT UNIQUE,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_case ON tasks(case_id, status);

-- ── مدارک ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'incomplete', 'rejected', 'approved')),
  note        TEXT,
  review_note TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  file_name   TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (case_id, kind)
);

-- ── جزئیات قرارداد ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_details (
  id                    TEXT PRIMARY KEY,
  case_id               TEXT NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
  contract_type         TEXT NOT NULL CHECK (contract_type IN ('rent', 'sale')),
  output_mode           TEXT NOT NULL CHECK (output_mode IN ('signature_only', 'signature_and_tracking')),
  property_address      TEXT,
  city                  TEXT,
  district              TEXT,
  area                  REAL,
  landlord_name         TEXT,
  tenant_name           TEXT,
  seller_name           TEXT,
  buyer_name            TEXT,
  deposit_amount        INTEGER,
  rent_amount           INTEGER,
  sale_price            INTEGER,
  start_date            TEXT,
  end_date              TEXT,
  terms_note            TEXT,
  clause_version        INTEGER NOT NULL DEFAULT 1,
  document_generated_at TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS legal_reviews (
  id                        TEXT PRIMARY KEY,
  case_id                   TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  reviewer_id               TEXT,
  result                    TEXT NOT NULL CHECK (result IN ('approved', 'needs_edit', 'rejected')),
  note                      TEXT,
  clause_version_at_review  INTEGER,
  at                        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_legal_case ON legal_reviews(case_id, at);

CREATE TABLE IF NOT EXISTS signatures (
  id         TEXT PRIMARY KEY,
  case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  party      TEXT NOT NULL,
  party_name TEXT,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'declined')),
  method     TEXT,
  signed_at  TEXT,
  note       TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (case_id, party)
);

CREATE TABLE IF NOT EXISTS tracking_requests (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'in_progress', 'error', 'received')),
  code         TEXT,
  error        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  requested_at TEXT,
  received_at  TEXT,
  updated_at   TEXT NOT NULL
);

-- ── مالی ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id         TEXT PRIMARY KEY,
  case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  amount     INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'void')),
  method     TEXT,
  created_at TEXT NOT NULL,
  paid_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_case ON invoices(case_id);

CREATE TABLE IF NOT EXISTS payments (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  invoice_id   TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  method       TEXT NOT NULL CHECK (method IN ('direct', 'subscription', 'referral', 'free')),
  amount       INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  provider     TEXT,
  provider_ref TEXT,
  error        TEXT,
  attempt      INTEGER NOT NULL DEFAULT 1,
  paid_at      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_case ON payments(case_id, created_at);

CREATE TABLE IF NOT EXISTS subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  plan_key   TEXT NOT NULL,
  scope      TEXT NOT NULL DEFAULT '[]',
  starts_at  TEXT NOT NULL,
  ends_at    TEXT,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id, status);

CREATE TABLE IF NOT EXISTS referral_codes (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL DEFAULT 'referral' CHECK (kind IN ('referral', 'waiver')),
  owner_user_id TEXT,
  scope         TEXT NOT NULL DEFAULT '[]',
  max_uses      INTEGER NOT NULL DEFAULT 1,
  used_count    INTEGER NOT NULL DEFAULT 0,
  expires_at    TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  note          TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_uses (
  id          TEXT PRIMARY KEY,
  code_id     TEXT NOT NULL REFERENCES referral_codes(id) ON DELETE CASCADE,
  case_id     TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  approved_by TEXT,
  used_at     TEXT NOT NULL,
  UNIQUE (code_id, case_id)
);

-- ── آگهی و نیازمندی ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listings (
  id            TEXT PRIMARY KEY,
  case_id       TEXT REFERENCES cases(id) ON DELETE CASCADE,
  external_id   TEXT,
  source        TEXT,
  owner_user_id TEXT,
  agent_user_id TEXT,
  deal_type     TEXT NOT NULL DEFAULT 'rent' CHECK (deal_type IN ('rent', 'sale')),
  property_type TEXT NOT NULL DEFAULT 'apartment',
  city          TEXT,
  district      TEXT,
  address       TEXT,
  area          REAL,
  rooms         INTEGER,
  year_built    INTEGER,
  price         INTEGER,
  deposit       INTEGER,
  rent          INTEGER,
  description   TEXT,
  amenities     TEXT NOT NULL DEFAULT '[]',
  images        TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'published', 'paused', 'expired', 'closed')),
  reject_reason TEXT,
  published_at  TEXT,
  expires_at    TEXT,
  views         INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_case ON listings(case_id);

CREATE TABLE IF NOT EXISTS requirements (
  id                 TEXT PRIMARY KEY,
  case_id            TEXT REFERENCES cases(id) ON DELETE CASCADE,
  external_id        TEXT,
  source             TEXT,
  requester_user_id  TEXT,
  deal_type          TEXT NOT NULL DEFAULT 'rent',
  property_type      TEXT,
  city               TEXT,
  districts          TEXT NOT NULL DEFAULT '[]',
  budget_min         INTEGER,
  budget_max         INTEGER,
  area_min           REAL,
  area_max           REAL,
  rooms              INTEGER,
  description        TEXT,
  access_level       TEXT NOT NULL DEFAULT 'staff' CHECK (access_level IN ('public', 'agents', 'staff')),
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'matched', 'fulfilled', 'expired', 'cancelled')),
  expires_at         TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS requirement_matches (
  id             TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  listing_id     TEXT NOT NULL,
  score          REAL NOT NULL DEFAULT 0,
  note           TEXT,
  at             TEXT NOT NULL,
  UNIQUE (requirement_id, listing_id)
);

-- ── پیام‌ها ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  channel    TEXT NOT NULL DEFAULT 'sms',
  template   TEXT NOT NULL,
  to_user_id TEXT,
  to_address TEXT,
  case_id    TEXT,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  error      TEXT,
  provider   TEXT,
  sent_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_case ON notifications(case_id, created_at);

-- ── گردش‌کار ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id           TEXT PRIMARY KEY,
  key          TEXT NOT NULL,
  version      INTEGER NOT NULL,
  name         TEXT NOT NULL,
  definition   TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  activated_at TEXT,
  UNIQUE (key, version)
);

-- ── سینک ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
  id              TEXT PRIMARY KEY,
  direction       TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  channel         TEXT NOT NULL CHECK (channel IN ('push', 'pull', 'webhook')),
  entity_type     TEXT,
  source          TEXT,
  idempotency_key TEXT,
  item_count      INTEGER NOT NULL DEFAULT 0,
  created         INTEGER NOT NULL DEFAULT 0,
  updated         INTEGER NOT NULL DEFAULT 0,
  unchanged       INTEGER NOT NULL DEFAULT 0,
  rejected        INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'partial', 'failed')),
  detail          TEXT,
  actor           TEXT,
  duration_ms     INTEGER,
  at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_log_at ON sync_log(at);

CREATE TABLE IF NOT EXISTS sync_item_results (
  id           TEXT PRIMARY KEY,
  sync_log_id  TEXT REFERENCES sync_log(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL,
  external_id  TEXT,
  action       TEXT NOT NULL,
  reason       TEXT,
  at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_items_log ON sync_item_results(sync_log_id);

CREATE TABLE IF NOT EXISTS outbound_webhooks (
  id              TEXT PRIMARY KEY,
  event           TEXT NOT NULL,
  case_id         TEXT,
  payload         TEXT NOT NULL,
  target_url      TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'dead')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TEXT,
  delivered_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhooks_status ON outbound_webhooks(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS pull_cursors (
  id             TEXT PRIMARY KEY,
  entity_type    TEXT NOT NULL UNIQUE,
  last_pulled_at TEXT,
  last_cursor    TEXT,
  updated_at     TEXT NOT NULL
);

-- ── حسابرسی و Idempotency ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  actor_type  TEXT NOT NULL,
  actor_id    TEXT,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  detail      TEXT,
  ip          TEXT,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key         TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,
  status      INTEGER NOT NULL DEFAULT 200,
  response    TEXT,
  created_at  TEXT NOT NULL,
  expires_at  TEXT
);
