import Link from "next/link";
import { requireSession, getCsrfToken } from "@/auth/session";
import { can } from "@/auth/rbac";
import * as Platform from "@/db/repos/platform";
import { INBOX_FILTERS } from "@/lib/fa-labels";
import { faNumber } from "@/lib/money";
import { InboxList } from "@/components/ops/inbox-list";

export const dynamic = "force-dynamic";

/**
 * صندوق اعلان داخلی کارمندان: ارجاع‌ها، صف واحد، منشن، پیام تازه، برگشت کار،
 * نزدیک/عبور از مهلت. هر اعلان به پرونده مرتبط لینک دارد.
 */
export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const csrf = await getCsrfToken();
  const params = await searchParams;
  const filter = typeof params.filter === "string" ? params.filter : "all";
  const unreadOnly = params.unread === "1";

  const items = Platform.listInbox(session.staff.id, { unreadOnly, limit: 50 });
  const payload = {
    items,
    unread: Platform.countUnreadInbox(session.staff.id),
    unreadByKind: {
      mention: Platform.countUnreadInbox(session.staff.id, "mention"),
      referral: Platform.countUnreadInbox(session.staff.id, "referral.new") + Platform.countUnreadInbox(session.staff.id, "referral.queue"),
      due: Platform.countUnreadInbox(session.staff.id, "ops.overdue") + Platform.countUnreadInbox(session.staff.id, "ops.due_soon"),
    },
  };

  return (
    <>
      <div className="card">
        <div className="card-title-row">
          <div>
            <h2 style={{ margin: 0 }}>صندوق اعلان داخلی</h2>
            <div className="small muted">
              اعلان‌های ارجاع، صف واحد، منشن همکار، پیام تازه، برگشت کار و سررسید مهلت — همه با لینک مستقیم به پرونده.
            </div>
          </div>
          <span className="small muted">{faNumber(payload.unread)} خوانده‌نشده</span>
        </div>

        <div className="filters">
          <div className="field">
            <label>دسته</label>
            <div className="flex wrap" style={{ gap: 8 }}>
              {INBOX_FILTERS.map((item) => {
                const active = item.key === filter;
                const query = new URLSearchParams();
                if (item.key !== "all") query.set("filter", item.key);
                if (unreadOnly) query.set("unread", "1");
                const suffix = query.toString();
                return (
                  <Link
                    key={item.key}
                    href={`/panel/inbox${suffix ? `?${suffix}` : ""}`}
                    className={`badge ${active ? "info" : "muted"}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="field">
            <label>نمایش</label>
            <div className="flex wrap" style={{ gap: 8 }}>
              <Link href={`/panel/inbox${filter !== "all" ? `?filter=${filter}` : ""}`} className={`badge ${unreadOnly ? "muted" : "info"}`}>
                همه
              </Link>
              <Link
                href={`/panel/inbox?${new URLSearchParams({ ...(filter !== "all" ? { filter } : {}), unread: "1" }).toString()}`}
                className={`badge ${unreadOnly ? "info" : "muted"}`}
              >
                فقط خوانده‌نشده‌ها
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <InboxList csrf={csrf} initial={payload} filter={filter} unreadOnly={unreadOnly} />
        {can(session.role, "report.view") ? (
          <div className="small muted" style={{ marginTop: 10 }}>
            اعلان‌ها فقط برای کارمند گیرنده نمایش داده می‌شوند؛ اقلام داخلی هرگز در API سینک یا پیام مشتری ظاهر نمی‌شوند.
          </div>
        ) : null}
      </div>
    </>
  );
}
