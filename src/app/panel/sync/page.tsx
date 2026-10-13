import { requireSession, getCsrfToken } from "@/auth/session";
import { can } from "@/auth/rbac";
import * as Platform from "@/db/repos/platform";
import * as People from "@/db/repos/people";
import * as Catalog from "@/db/repos/catalog";
import * as Cases from "@/db/repos/cases";
import { syncOverview } from "@/services/sync";
import { toJalaliDateTime, relativeFa } from "@/lib/jalali";
import { faNumber } from "@/lib/money";
import { ENTITY_LABELS, SYNC_CHANNEL_LABELS, SYNC_STATUS_LABELS, WEBHOOK_STATUS_LABELS, labelOf } from "@/lib/fa-labels";
import { ActionForm, Field } from "../forms";
import { dispatchWebhooksAction, pullNowAction, purgeDeadWebhooksAction, retryWebhookAction, saveSyncSettingsAction, seedDefinitionsAction } from "./actions";

export const dynamic = "force-dynamic";

const ENTITY_OPTIONS = [
  { value: "", label: "همه موجودیت‌ها" },
  { value: "users", label: "کاربران" },
  { value: "contracts", label: "قراردادها" },
  { value: "listings", label: "آگهی‌ها" },
  { value: "requirements", label: "نیازمندی‌ها" },
];

export default async function SyncPage() {
  const session = await requireSession();
  const csrf = await getCsrfToken();
  const overview = syncOverview();
  const isAdmin = can(session.role, "sync.manage");
  const counts = {
    users: People.countUsers().total,
    contracts: Cases.listCases({ limit: 1000 }).filter((c) => c.workflow_key === "contract").length,
    listings: Catalog.listListings({ limit: 1000 }).length,
    requirements: Catalog.listRequirements({ limit: 1000 }).length,
  };
  const pendingWebhooks = overview.webhooks.filter((hook) => hook.status === "pending" || hook.status === "failed").length;
  const deadWebhooks = overview.webhooks.filter((hook) => hook.status === "dead").length;
  const keyConfigured = Boolean(process.env.SYNC_API_KEY);
  const secretConfigured = Boolean(process.env.SYNC_SECRET);

  return (
    <>
      <div className="grid grid-4">
        <div className="stat">
          <div className="k">آخرین همگام‌سازی</div>
          <div className="v small">{overview.lastSync ? relativeFa(overview.lastSync.at) : "بدون سابقه"}</div>
          <div className="small muted">{overview.lastSync ? `${labelOf(ENTITY_LABELS, overview.lastSync.entity_type)} از ${overview.lastSync.source}` : ""}</div>
        </div>
        <div className="stat">
          <div className="k">رکوردهای سینک‌شده</div>
          <div className="v">{faNumber(counts.users + counts.contracts + counts.listings + counts.requirements)}</div>
          <div className="small muted">
            کاربر {faNumber(counts.users)} · قرارداد {faNumber(counts.contracts)} · آگهی {faNumber(counts.listings)} · نیازمندی{" "}
            {faNumber(counts.requirements)}
          </div>
        </div>
        <div className="stat">
          <div className="k">وب‌هوک در انتظار</div>
          <div className="v">{faNumber(pendingWebhooks)}</div>
          <div className="small muted">{deadWebhooks ? `${faNumber(deadWebhooks)} مورد مرده` : "بدون مورد مرده"}</div>
        </div>
        <div className="stat">
          <div className="k">امنیت سینک</div>
          <div className="v small">
            کلید: {keyConfigured ? "تنظیم‌شده" : "تنظیم‌نشده"} · امضا: {secretConfigured ? "فعال" : "غیرفعال"}
          </div>
          <div className="small muted">SYNC_API_KEY / SYNC_SECRET</div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>واکشی دستی از سرور اصلی (Pull)</h3>
          <p className="small muted">
            آدرس پایه از <span className="mono">SYNC_PULL_URL</span> خوانده می‌شود و برای هر موجودیت درخواست{" "}
            <span className="mono">GET /{"{entity}"}?since=…</span> ارسال می‌شود. کرسور هر موجودیت جداگانه نگه‌داری می‌شود.
          </p>
          {overview.pullUrl ? <div className="small mono">{overview.pullUrl}</div> : <div className="alert warning">آدرس واکشی تنظیم نشده است (SYNC_PULL_URL).</div>}
          {isAdmin ? (
            <ActionForm action={pullNowAction} csrf={csrf} submitLabel="واکشی اکنون" submitClass="secondary">
              <Field label="موجودیت" name="entity" type="select" defaultValue="" options={ENTITY_OPTIONS} emptyLabel="همه موجودیت‌ها" />
            </ActionForm>
          ) : (
            <div className="alert info">واکشی فقط توسط مدیر انجام می‌شود.</div>
          )}
        </div>

        <div className="card">
          <h3>ارسال تغییرات به سرور اصلی (Push)</h3>
          <p className="small muted">
            رویدادهای پرونده و آگهی در صف وب‌هوک قرار می‌گیرند و با امضای <span className="mono">X-Webhook-Signature</span> و حداکثر ۵ تلاش
            (backoff نمایی) ارسال می‌شوند.
          </p>
          {overview.webhookUrl ? <div className="small mono">{overview.webhookUrl}</div> : <div className="alert warning">آدرس وب‌هوک تنظیم نشده است (WEBHOOK_TARGET_URL).</div>}
          {isAdmin ? (
            <div className="actions-row" style={{ marginTop: 10 }}>
              <ActionForm action={dispatchWebhooksAction} csrf={csrf} submitLabel="ارسال وب‌هوک‌های سررسیده" submitClass="secondary small" compact />
              <ActionForm action={purgeDeadWebhooksAction} csrf={csrf} submitLabel="پاک‌سازی موارد مرده" submitClass="danger small" compact />
            </div>
          ) : null}
        </div>
      </div>

      {isAdmin ? (
        <div className="card">
          <h3>تنظیمات سینک</h3>
          <ActionForm action={saveSyncSettingsAction} csrf={csrf} submitLabel="ذخیره تنظیمات" submitClass="secondary">
            <div className="form-row">
              <Field label="آدرس واکشی (SYNC_PULL_URL)" name="pullUrl" defaultValue={overview.pullUrl} placeholder="https://api.example.com/crm-sync" />
              <Field label="آدرس وب‌هوک خروجی" name="webhookUrl" defaultValue={overview.webhookUrl} placeholder="https://api.example.com/crm-webhook" />
              <Field
                label="واکشی زمان‌بندی‌شده فعال باشد"
                name="pullEnabled"
                type="select"
                defaultValue={overview.pullEnabled ? "true" : "false"}
                options={[
                  { value: "false", label: "خیر" },
                  { value: "true", label: "بله" },
                ]}
              />
            </div>
          </ActionForm>

          <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <h4 style={{ fontSize: 13.5 }}>بارگذاری تعریف‌های گردش‌کار و خدمات پیش‌فرض</h4>
            <p className="small muted">تعریف‌های <span className="mono">workflow-definitions/*.json</span> را در دیتابیس ثبت و فعال می‌کند.</p>
            <ActionForm action={seedDefinitionsAction} csrf={csrf} submitLabel="بارگذاری از فایل" submitClass="secondary small" compact />
          </div>
        </div>
      ) : null}

      <div className="card">
        <h3>کرسورهای واکشی</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>موجودیت</th>
                <th>آخرین واکشی</th>
                <th>کرسور</th>
                <th>رکوردهای محلی</th>
              </tr>
            </thead>
            <tbody>
              {(["users", "contracts", "listings", "requirements"] as const).map((entity) => {
                const cursor = overview.cursors[entity];
                return (
                  <tr key={entity}>
                    <td>{labelOf(ENTITY_LABELS, entity)}</td>
                    <td className="small">{cursor.lastPulledAt ? toJalaliDateTime(cursor.lastPulledAt) : "هرگز"}</td>
                    <td className="small mono">{cursor.lastCursor ?? "—"}</td>
                    <td className="small">{faNumber(counts[entity])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>تاریخچه سینک</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>زمان</th>
                <th>موجودیت</th>
                <th>جهت</th>
                <th>تعداد آیتم</th>
                <th>ثبت‌شده</th>
                <th>به‌روزشده</th>
                <th>بدون تغییر</th>
                <th>رد‌شده</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {overview.logs.length ? (
                overview.logs.map((log) => (
                  <tr key={log.id}>
                    <td className="small">{toJalaliDateTime(log.at)}</td>
                    <td className="small">{labelOf(ENTITY_LABELS, log.entity_type)}</td>
                    <td className="small">
                      <span className={`badge ${log.channel === "pull" ? "info" : "muted"}`}>{labelOf(SYNC_CHANNEL_LABELS, log.channel)}</span>
                    </td>
                    <td className="small">{faNumber(log.item_count)}</td>
                    <td className="small">{faNumber(log.created)}</td>
                    <td className="small">{faNumber(log.updated)}</td>
                    <td className="small">{faNumber(log.unchanged)}</td>
                    <td className="small" style={log.rejected ? { color: "var(--warning)" } : undefined}>
                      {faNumber(log.rejected)}
                    </td>
                    <td className="small">
                      <span className={`badge ${log.status === "ok" ? "success" : log.status === "partial" ? "warning" : "danger"}`}>
                        {labelOf(SYNC_STATUS_LABELS, log.status)}
                      </span>
                      {log.detail ? <div className="small muted">{log.detail}</div> : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="empty">
                    هنوز سینکی انجام نشده است. سرور اصلی می‌تواند به <span className="mono">POST /api/v1/ingest/contracts</span> و بقیه endpointها
                    داده بفرستد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>وب‌هوک‌های خروجی</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>رویداد</th>
                <th>پرونده</th>
                <th>وضعیت</th>
                <th>تلاش</th>
                <th>آخرین خطا</th>
                <th>تلاش بعدی</th>
                <th>اقدام</th>
              </tr>
            </thead>
            <tbody>
              {overview.webhooks.length ? (
                overview.webhooks.map((hook) => {
                  const caseRow = hook.case_id ? Cases.findCaseById(hook.case_id) : null;
                  return (
                    <tr key={hook.id}>
                      <td className="small mono">{hook.event}</td>
                      <td className="small">{caseRow ? caseRow.code ?? caseRow.title ?? "—" : "—"}</td>
                      <td>
                        <span
                          className={`badge ${
                            hook.status === "delivered" ? "success" : hook.status === "dead" ? "danger" : hook.status === "failed" ? "warning" : "muted"
                          }`}
                        >
                          {labelOf(WEBHOOK_STATUS_LABELS, hook.status)}
                        </span>
                      </td>
                      <td className="small">{faNumber(hook.attempts)}</td>
                      <td className="small">{hook.last_error ?? "—"}</td>
                      <td className="small">{hook.next_attempt_at ? relativeFa(hook.next_attempt_at) : "—"}</td>
                      <td>
                        {hook.status === "delivered" ? (
                          "—"
                        ) : isAdmin ? (
                          <ActionForm
                            action={retryWebhookAction}
                            csrf={csrf}
                            hidden={{ webhookId: hook.id }}
                            submitLabel="بازگشت به صف"
                            submitClass="secondary small"
                            compact
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="empty">
                    وب‌هوکی در صف نیست.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>قرارداد API برای سرور اصلی</h3>
        <div className="kv">
          <div>
            <div className="k">Push (سرور اصلی ← CRM)</div>
            <div className="v small">
              <div className="mono">POST /api/v1/ingest/users</div>
              <div className="mono">POST /api/v1/ingest/contracts</div>
              <div className="mono">POST /api/v1/ingest/listings</div>
              <div className="mono">POST /api/v1/ingest/requirements</div>
              هدرها: <span className="mono">X-Sync-Key</span>، <span className="mono">X-Signature: sha256=HMAC(secret, rawBody)</span>،{" "}
              <span className="mono">X-Idempotency-Key</span>
            </div>
          </div>
          <div>
            <div className="k">Pull (CRM ← سرور اصلی)</div>
            <div className="v small">
              <div className="mono">GET /{"{entity}"}?since=ISO</div>
              پاسخ: <span className="mono">{`{ "items": [...] }`}</span> — همان ساختار Push. هر آیتم با کلید{" "}
              <span className="mono">(source, externalId)</span> upsert می‌شود.
            </div>
          </div>
          <div>
            <div className="k">Push (CRM ← تغییرات)</div>
            <div className="v small">
              رویدادها: <span className="mono">case.&lt;نتیجه&gt;</span>، <span className="mono">listing.published</span>،{" "}
              <span className="mono">payment.&lt;status&gt;</span>، <span className="mono">tracking.&lt;status&gt;</span>. هدر{" "}
              <span className="mono">X-Webhook-Signature</span> با همان secret قابل بررسی است.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
