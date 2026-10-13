import Link from "next/link";
import { requireSession } from "@/auth/session";
import * as People from "@/db/repos/people";
import * as Cases from "@/db/repos/cases";
import { toJalali, toJalaliDateTime } from "@/lib/jalali";
import { faNumber } from "@/lib/money";
import { USER_TYPE_LABELS, labelOf } from "@/lib/fa-labels";

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : undefined;
  const type = typeof params.type === "string" && params.type ? (params.type as "normal" | "agent") : undefined;

  const users = People.listUsers({ search: q, type, limit: 500 });
  const counts = People.countUsers();

  // شماره پرونده‌های هر کاربر برای نمایش سریع
  const caseCounts = new Map<string, number>();
  for (const row of Cases.listCases({ limit: 1000 })) {
    if (!row.owner_user_id) continue;
    caseCounts.set(row.owner_user_id, (caseCounts.get(row.owner_user_id) ?? 0) + 1);
  }

  return (
    <>
      <div className="grid grid-4">
        <div className="stat">
          <div className="k">کل کاربران</div>
          <div className="v">{faNumber(counts.total)}</div>
        </div>
        <div className="stat">
          <div className="k">کاربر عادی</div>
          <div className="v">{faNumber(counts.normal)}</div>
        </div>
        <div className="stat">
          <div className="k">مشاور املاک</div>
          <div className="v">{faNumber(counts.agents)}</div>
        </div>
        <div className="stat">
          <div className="k">نمایش در این فهرست</div>
          <div className="v">{faNumber(users.length)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2 style={{ margin: 0 }}>کاربران سینک‌شده</h2>
          <span className="small muted">این کاربران از سرور اصلی دریافت می‌شوند و در CRM فقط نمایش/استفاده می‌شوند.</span>
        </div>
        <form method="get" className="filters">
          <div className="field">
            <label htmlFor="f-q">جستجو (نام / موبایل / کد ملی)</label>
            <input id="f-q" name="q" defaultValue={q ?? ""} placeholder="مثلاً ۰۹۱۲…" />
          </div>
          <div className="field">
            <label htmlFor="f-type">نوع کاربر</label>
            <select id="f-type" name="type" defaultValue={type ?? ""}>
              <option value="">همه</option>
              <option value="normal">کاربر عادی</option>
              <option value="agent">مشاور املاک</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-submit">&nbsp;</label>
            <button type="submit" id="f-submit">
              اعمال فیلتر
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>نام</th>
                <th>موبایل</th>
                <th>نوع</th>
                <th>شهر</th>
                <th>منبع سینک</th>
                <th>پرونده‌ها</th>
                <th>آخرین سینک</th>
              </tr>
            </thead>
            <tbody>
              {users.length ? (
                users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <Link href={`/panel/users/${user.id}`}>{user.full_name}</Link>
                      {user.deleted ? <span className="badge muted">حذف‌شده</span> : null}
                    </td>
                    <td className="mono small">{user.mobile ?? "—"}</td>
                    <td>
                      <span className={`badge ${user.user_type === "agent" ? "info" : "muted"}`}>{labelOf(USER_TYPE_LABELS, user.user_type)}</span>
                      {user.agent_license_no ? <div className="small muted mono">{user.agent_license_no}</div> : null}
                    </td>
                    <td className="small">{user.city ?? "—"}</td>
                    <td className="small mono">{user.source ?? "دستی"}</td>
                    <td className="small">{faNumber(caseCounts.get(user.id) ?? 0)}</td>
                    <td className="small">{user.synced_at ? toJalaliDateTime(user.synced_at) : "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="empty">
                    کاربری یافت نشد. برای دریافت داده‌ها از سرور اصلی از بخش «سینک» استفاده کنید.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export async function generateMetadata() {
  return { title: `کاربران — ${toJalali(new Date().toISOString())}` };
}
