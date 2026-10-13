import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/session";
import * as People from "@/db/repos/people";
import * as Cases from "@/db/repos/cases";
import * as Catalog from "@/db/repos/catalog";
import * as Finance from "@/db/repos/finance";
import { loadDefinition } from "@/domain/workflows";
import { toJalali, toJalaliDateTime, relativeFa } from "@/lib/jalali";
import { faMoney, faNumber } from "@/lib/money";
import { USER_TYPE_LABELS, labelOf, stateLabel } from "@/lib/fa-labels";

export const dynamic = "force-dynamic";

const WORKFLOW_OF: Record<string, string> = {
  contract: "contract",
  listing: "listing",
  requirements: "requirements",
  custom: "custom_service",
};

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const user = People.findUserById(id);
  if (!user) notFound();

  const caseRows = Cases.listCases({ limit: 500 }).filter((row) => row.owner_user_id === user.id);
  const subscriptions = Finance.listSubscriptions(user.id);
  const services = Catalog.listServices();
  const listings = Catalog.listListings({ limit: 200 }).filter((l) => l.owner_user_id === user.id);
  const requirements = Catalog.listRequirements({ limit: 200 }).filter((r) => r.requester_user_id === user.id);
  const definitions = new Map(["contract", "listing", "requirements", "custom_service"].map((key) => [key, loadDefinition(key, 1)] as const));

  return (
    <>
      <div className="card">
        <div className="card-title-row">
          <div>
            <h2 style={{ margin: 0 }}>
              {user.full_name}
              <span className={`badge ${user.user_type === "agent" ? "info" : "muted"}`}>{labelOf(USER_TYPE_LABELS, user.user_type)}</span>
              {user.deleted ? <span className="badge danger">حذف‌شده در سرور اصلی</span> : null}
            </h2>
            <div className="small muted">
              شناسه سرور اصلی: <span className="mono">{user.external_id ?? "—"}</span> · منبع: {user.source ?? "دستی"} · آخرین سینک:{" "}
              {user.synced_at ? toJalaliDateTime(user.synced_at) : "—"}
            </div>
          </div>
          <Link href="/panel/users" className="btn secondary small">
            بازگشت
          </Link>
        </div>
        <div className="kv">
          <div>
            <div className="k">موبایل</div>
            <div className="v mono">{user.mobile ?? "—"}</div>
          </div>
          <div>
            <div className="k">کد ملی</div>
            <div className="v mono">{user.national_id ?? "—"}</div>
          </div>
          <div>
            <div className="k">ایمیل</div>
            <div className="v">{user.email ?? "—"}</div>
          </div>
          <div>
            <div className="k">شهر</div>
            <div className="v">{user.city ?? "—"}</div>
          </div>
          <div>
            <div className="k">پروانه مشاور</div>
            <div className="v mono">{user.agent_license_no ?? "—"}</div>
          </div>
          <div>
            <div className="k">وضعیت</div>
            <div className="v">{user.status}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>اشتراک‌ها</h3>
        {subscriptions.length ? (
          <table>
            <thead>
              <tr>
                <th>طرح</th>
                <th>دامنه</th>
                <th>وضعیت</th>
                <th>شروع</th>
                <th>پایان</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((sub) => (
                <tr key={sub.id}>
                  <td>{sub.plan_key}</td>
                  <td className="small">{sub.scope}</td>
                  <td>
                    <span className={`badge ${sub.status === "active" ? "success" : "muted"}`}>
                      {sub.status === "active" ? "فعال" : sub.status === "expired" ? "منقضی" : sub.status}
                    </span>
                  </td>
                  <td className="small">{toJalali(sub.starts_at)}</td>
                  <td className="small">{toJalali(sub.ends_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">اشتراکی ثبت نشده است.</div>
        )}
      </div>

      <div className="card">
        <h3>پرونده‌ها ({faNumber(caseRows.length)})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>کد</th>
                <th>عنوان</th>
                <th>خدمت</th>
                <th>وضعیت</th>
                <th>اولویت</th>
                <th>آخرین تغییر</th>
              </tr>
            </thead>
            <tbody>
              {caseRows.length ? (
                caseRows.map((row) => {
                  const service = services.find((s) => s.key === row.service_key);
                  const definition = definitions.get(WORKFLOW_OF[service?.category ?? "contract"] ?? "contract") ?? null;
                  return (
                    <tr key={row.id}>
                      <td className="mono">
                        <Link href={`/panel/cases/${row.id}`}>{row.code ?? row.id.slice(-6)}</Link>
                      </td>
                      <td>{row.title ?? "—"}</td>
                      <td className="small">{service?.name ?? row.service_key}</td>
                      <td>
                        <span className={`badge ${row.status === "closed" ? "muted" : "info"}`}>{stateLabel(definition, row.state)}</span>
                      </td>
                      <td className="small">{row.priority}</td>
                      <td className="small">{relativeFa(row.last_transition_at ?? row.updated_at)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="empty">
                    پرونده‌ای برای این کاربر ثبت نشده است.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>آگهی‌های این کاربر</h3>
          {listings.length ? (
            <table>
              <thead>
                <tr>
                  <th>عنوان</th>
                  <th>وضعیت</th>
                  <th>مبلغ</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((listing) => (
                  <tr key={listing.id}>
                    <td>
                      {listing.city} — {listing.district}
                      <div className="small muted">{faNumber(listing.area ?? 0)} متر</div>
                    </td>
                    <td>
                      <span className="badge muted">{listing.status}</span>
                    </td>
                    <td className="small">
                      {listing.deal_type === "rent"
                        ? `${faMoney(listing.deposit)} ودیعه / ${faMoney(listing.rent)} اجاره`
                        : faMoney(listing.price)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">آگهی‌ای ثبت نشده است.</div>
          )}
        </div>

        <div className="card">
          <h3>نیازمندی‌های این کاربر</h3>
          {requirements.length ? (
            <table>
              <thead>
                <tr>
                  <th>نوع</th>
                  <th>شهر/محله</th>
                  <th>بودجه</th>
                  <th>وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {requirements.map((req) => (
                  <tr key={req.id}>
                    <td className="small">{req.deal_type === "rent" ? "اجاره" : "خرید"}</td>
                    <td className="small">
                      {req.city} — {(JSON.parse(req.districts || "[]") as string[]).join("، ") || "همه محله‌ها"}
                    </td>
                    <td className="small">
                      {faMoney(req.budget_min)} تا {faMoney(req.budget_max)}
                    </td>
                    <td>
                      <span className="badge muted">{req.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">نیازمندی‌ای ثبت نشده است.</div>
          )}
        </div>
      </div>

      {user.raw ? (
        <details className="card">
          <summary>داده خام دریافتی از سرور اصلی</summary>
          <pre className="mono small" style={{ overflowX: "auto", direction: "ltr" }}>
            {JSON.stringify(JSON.parse(user.raw), null, 2)}
          </pre>
        </details>
      ) : null}
    </>
  );
}
