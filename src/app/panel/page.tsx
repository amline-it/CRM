import Link from "next/link";
import { requireSession } from "@/auth/session";
import * as Cases from "@/db/repos/cases";
import * as Catalog from "@/db/repos/catalog";
import * as Finance from "@/db/repos/finance";
import * as People from "@/db/repos/people";
import * as Platform from "@/db/repos/platform";
import { loadDefinition } from "@/domain/workflows";
import { faMoney, faNumber } from "@/lib/money";
import { PRIORITY_LABELS, stateLabel } from "@/lib/fa-labels";
import { toJalaliDateTime, relativeFa } from "@/lib/jalali";

export const dynamic = "force-dynamic";

const QUEUE_STATES = [
  "documents_review",
  "documents_pending_queue",
  "legal_review",
  "legal_result",
  "signature_collect",
  "signature_followup",
  "tracking_request",
  "tracking_check",
  "tracking_error",
  "payment_error",
  "listing_review",
  "listing_result",
  "service_finance",
  "service_review",
];

export default async function DashboardPage() {
  const session = await requireSession();
  const openCases = Cases.listCases({ status: "open", limit: 200 });
  const stateCounts = Cases.countCasesByState(QUEUE_STATES);
  const tasks = Cases.listTasks({
    assigneeId: session.staff.id,
    status: ["open", "in_progress"],
    limit: 8,
  });
  const stats = Finance.paymentStats();
  const webhooks = Platform.dueWebhooks(5);
  const recent = Cases.recentTimeline(12);
  const users = People.countUsers();
  const expiredListings = Catalog.listListings({ status: "published", limit: 200 }).filter(
    (l) => l.expires_at && new Date(l.expires_at).getTime() <= Date.now(),
  );

  const queueTotal = QUEUE_STATES.reduce((sum, key) => sum + (stateCounts[key] ?? 0), 0);

  return (
    <>
      <div className="grid grid-4">
        <div className="stat">
          <div className="label">پرونده‌های باز</div>
          <div className="value">{faNumber(openCases.length)}</div>
          <div className="hint">{faNumber(queueTotal)} مورد در صف‌های کاری</div>
        </div>
        <div className="stat">
          <div className="label">وظایف باز من</div>
          <div className="value">{faNumber(tasks.length)}</div>
          <div className="hint">{faNumber(Cases.countOpenTasks().overdue)} مورد سررسیدگذشته در کل تیم</div>
        </div>
        <div className="stat">
          <div className="label">درآمد ماه (پرداخت موفق)</div>
          <div className="value">{faMoney(stats.paidMonth)}</div>
          <div className="hint">امروز: {faMoney(stats.paidToday)}</div>
        </div>
        <div className="stat">
          <div className="label">کاربران سینک‌شده</div>
          <div className="value">{faNumber(users.total)}</div>
          <div className="hint">{faNumber(users.agents)} مشاور · {faNumber(users.normal)} کاربر عادی</div>
        </div>
      </div>

      {webhooks.length || expiredListings.length ? (
        <div className="card">
          <h3>هشدارهای عملیاتی</h3>
          <ul style={{ margin: 0, paddingRight: 18 }}>
            {expiredListings.length ? (
              <li>
                <b>{faNumber(expiredListings.length)}</b> آگهی منتشرشده از تاریخ انقضا گذشته است؛{" "}
                <Link href="/panel/listings?status=published">بررسی آگهی‌ها</Link>
              </li>
            ) : null}
            {webhooks.length ? (
              <li>
                <b>{faNumber(webhooks.length)}</b> وب‌هوک خروجی در انتظار ارسال به سرور اصلی است؛{" "}
                <Link href="/panel/sync">وضعیت سینک</Link>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title-row">
            <h3>صف‌های کاری</h3>
            <Link href="/panel/cases" className="small">
              همه پرونده‌ها
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>مرحله</th>
                  <th>تعداد</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {QUEUE_STATES.map((state) => (
                  <tr key={state}>
                    <td>{stateLabel(loadDefinition(workflowOf(state), 1), state)}</td>
                    <td>{faNumber(stateCounts[state] ?? 0)}</td>
                    <td>
                      <Link className="small" href={`/panel/cases?state=${state}`}>
                        مشاهده
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-title-row">
            <h3>وظایف من</h3>
            <Link href="/panel/tasks" className="small">
              کارتابل کامل
            </Link>
          </div>
          {tasks.length ? (
            <table>
              <thead>
                <tr>
                  <th>وظیفه</th>
                  <th>اولویت</th>
                  <th>سررسید</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      {task.case_id ? <Link href={`/panel/cases/${task.case_id}`}>{task.title}</Link> : task.title}
                    </td>
                    <td>
                      <span className={`badge ${task.priority === "high" || task.priority === "urgent" ? "danger" : "muted"}`}>
                        {PRIORITY_LABELS[task.priority] ?? task.priority}
                      </span>
                    </td>
                    <td className="small">{task.due_at ? relativeFa(task.due_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">وظیفه بازی برای شما ثبت نشده است.</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h3>آخرین رویدادها</h3>
        </div>
        {recent.length ? (
          <ul className="timeline">
            {recent.map((event) => (
              <li key={event.id} className={event.visibility === "external" ? "external" : ""}>
                <div className="t-title">
                  <Link href={`/panel/cases/${event.case_id}`}>{event.title}</Link>
                </div>
                <div className="t-meta">
                  {toJalaliDateTime(event.at)} · {relativeFa(event.at)}
                  {event.actor_name ? ` · ${event.actor_name}` : ""}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">هنوز رویدادی ثبت نشده است.</div>
        )}
      </div>
    </>
  );
}

function workflowOf(state: string): string {
  if (state.startsWith("listing")) return "listing";
  if (state.startsWith("requirements")) return "requirements";
  if (state.startsWith("service")) return "custom_service";
  return "contract";
}
