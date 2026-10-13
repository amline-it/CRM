import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/session";
import { can } from "@/auth/rbac";
import * as Platform from "@/db/repos/platform";
import { toJalaliDateTime } from "@/lib/jalali";
import { faNumber } from "@/lib/money";
import { STAFF_ROLE_LABELS, labelOf } from "@/lib/fa-labels";

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "ورود کارشناس",
  "auth.login.sso": "ورود با SSO",
  "auth.logout": "خروج",
  "staff.bootstrap": "ایجاد مدیر نخست",
  "staff.create": "ایجاد کارشناس",
  "staff.update": "ویرایش کارشناس",
  "staff.reset_password": "تغییر رمز کارشناس",
  "staff.revoke_sessions": "بستن نشست‌ها",
  "case.create": "تشکیل پرونده",
  "service.save": "ذخیره خدمت",
  "service.activate": "فعال‌سازی خدمت",
  "service.deactivate": "غیرفعال‌سازی خدمت",
  "workflow.import": "بارگذاری تعریف گردش‌کار",
  "workflow.activate": "فعال‌سازی نسخه گردش‌کار",
  "workflow.deactivate": "غیرفعال‌سازی نسخه گردش‌کار",
  "workflow.seed": "بارگذاری تعریف‌ها از فایل",
  "sync.pull": "واکشی از سرور اصلی",
  "sync.dispatch_webhooks": "ارسال وب‌هوک‌ها",
  "sync.save_settings": "ذخیره تنظیمات سینک",
  "sync.webhook_retry": "بازگرداندن وب‌هوک به صف",
  "sync.purge_dead_webhooks": "پاک‌سازی وب‌هوک‌های مرده",
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!can(session.role, "audit.view")) redirect("/panel");

  const params = await searchParams;
  const filter = typeof params.q === "string" ? params.q : undefined;
  const page = Math.max(0, Number(typeof params.page === "string" ? params.page : "0") || 0);
  const perPage = 100;

  const rows = Platform.listAudit(perPage, page * perPage);
  const filtered = filter
    ? rows.filter((row) =>
        [row.action, row.actor_name ?? "", row.entity_type ?? "", row.entity_id ?? ""].some((value) =>
          String(value).toLowerCase().includes(filter.toLowerCase()),
        ),
      )
    : rows;

  return (
    <>
      <div className="card">
        <div className="card-title-row">
          <div>
            <h2 style={{ margin: 0 }}>گزارش رویدادها (Audit)</h2>
            <div className="small muted">همه اقدام‌های کارشناسان و مدیران با کاربر، زمان و شناسه موجودیت ثبت می‌شود.</div>
          </div>
          <span className="small muted">{faNumber(filtered.length)} رویداد</span>
        </div>
        <form method="get" className="filters">
          <div className="field">
            <label htmlFor="f-q">جستجو (اقدام / کاربر / شناسه)</label>
            <input id="f-q" name="q" defaultValue={filter ?? ""} placeholder="case.transition.…" />
          </div>
          <input type="hidden" name="page" value="0" />
          <div className="field">
            <label htmlFor="f-submit">&nbsp;</label>
            <button type="submit" id="f-submit">
              جستجو
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>زمان</th>
                <th>کاربر</th>
                <th>نقش</th>
                <th>اقدام</th>
                <th>موجودیت</th>
                <th>شناسه</th>
                <th>جزئیات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length ? (
                filtered.map((row) => (
                  <tr key={row.id}>
                    <td className="small">{toJalaliDateTime(row.at)}</td>
                    <td className="small">{row.actor_name ?? "—"}</td>
                    <td className="small">{labelOf(STAFF_ROLE_LABELS, row.actor_type)}</td>
                    <td className="small">
                      {ACTION_LABELS[row.action] ?? row.action.replace("case.transition.", "گذار: ")}
                    </td>
                    <td className="small">{row.entity_type ?? "—"}</td>
                    <td className="small mono">
                      {row.entity_type === "case" && row.entity_id ? (
                        <Link href={`/panel/cases/${row.entity_id}`}>{row.entity_id.slice(-8)}</Link>
                      ) : (
                        row.entity_id ?? "—"
                      )}
                    </td>
                    <td className="small muted">
                      {row.detail && row.detail !== "null" ? <span className="mono">{row.detail}</span> : "—"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="empty">
                    رویدادی با این جستجو یافت نشد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="actions-row" style={{ marginTop: 12 }}>
          {page > 0 ? (
            <Link className="btn secondary small" href={`/panel/audit?page=${page - 1}${filter ? `&q=${encodeURIComponent(filter)}` : ""}`}>
              صفحه قبل
            </Link>
          ) : null}
          {rows.length === perPage ? (
            <Link className="btn secondary small" href={`/panel/audit?page=${page + 1}${filter ? `&q=${encodeURIComponent(filter)}` : ""}`}>
              صفحه بعد
            </Link>
          ) : null}
        </div>
      </div>
    </>
  );
}
