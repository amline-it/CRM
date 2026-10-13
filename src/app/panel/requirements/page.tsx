import Link from "next/link";
import { requireSession, getCsrfToken } from "@/auth/session";
import * as Catalog from "@/db/repos/catalog";
import * as Cases from "@/db/repos/cases";
import * as People from "@/db/repos/people";
import { loadDefinition } from "@/domain/workflows";
import { toJalali, relativeFa } from "@/lib/jalali";
import { faMoney, faNumber } from "@/lib/money";
import { ACCESS_LEVEL_LABELS, REQUIREMENT_STATUS_LABELS, labelOf, stateLabel } from "@/lib/fa-labels";
import { ActionForm } from "../forms";
import { computeMatchesAction, transitionAction } from "../cases/actions";

export const dynamic = "force-dynamic";

export default async function RequirementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();
  const csrf = await getCsrfToken();
  const params = await searchParams;
  const access = typeof params.access === "string" && params.access ? params.access : undefined;
  const status = typeof params.status === "string" && params.status ? params.status : undefined;

  const requirements = Catalog.listRequirements({ accessLevels: access ? [access] : undefined, status, limit: 300 });
  const definition = loadDefinition("requirements", 1);
  const all = Catalog.listRequirements({ limit: 1000 });

  return (
    <>
      <div className="grid grid-4">
        <div className="stat">
          <div className="k">کل نیازمندی‌ها</div>
          <div className="v">{faNumber(all.length)}</div>
        </div>
        <div className="stat">
          <div className="k">باز</div>
          <div className="v">{faNumber(all.filter((r) => r.status === "open").length)}</div>
        </div>
        <div className="stat">
          <div className="k">تطبیق‌یافته</div>
          <div className="v">{faNumber(all.filter((r) => r.status === "matched").length)}</div>
        </div>
        <div className="stat">
          <div className="k">انجام‌شده</div>
          <div className="v">{faNumber(all.filter((r) => r.status === "fulfilled").length)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2 style={{ margin: 0 }}>نیازمندی‌ها</h2>
          <span className="small muted">برای تشکیل نیازمندی جدید، از صفحه «پرونده‌ها» با خدمت نیازمندی استفاده کنید.</span>
        </div>
        <form method="get" className="filters">
          <div className="field">
            <label htmlFor="f-status">وضعیت</label>
            <select id="f-status" name="status" defaultValue={status ?? ""}>
              <option value="">همه</option>
              {Object.entries(REQUIREMENT_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-access">سطح نمایش</label>
            <select id="f-access" name="access" defaultValue={access ?? ""}>
              <option value="">همه</option>
              {Object.entries(ACCESS_LEVEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
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

      {requirements.map((req) => {
        const caseRow = req.case_id ? Cases.findCaseById(req.case_id) : null;
        const requester = req.requester_user_id ? People.findUserById(req.requester_user_id) : null;
        const districts = JSON.parse(req.districts || "[]") as string[];
        const matches = Catalog.listMatches(req.id);
        const openCase = caseRow && caseRow.status !== "closed" ? caseRow : null;

        return (
          <div className="card" key={req.id}>
            <div className="card-title-row">
              <div>
                <h3 style={{ margin: 0 }}>
                  {req.deal_type === "rent" ? "اجاره" : "خرید"} · {req.property_type ?? "هر نوع ملک"} · {req.city ?? "همه شهرها"}
                  <span className={`badge ${req.status === "open" ? "info" : req.status === "fulfilled" ? "success" : "muted"}`}>
                    {labelOf(REQUIREMENT_STATUS_LABELS, req.status)}
                  </span>
                  <span className="badge muted">{labelOf(ACCESS_LEVEL_LABELS, req.access_level)}</span>
                </h3>
                <div className="small muted">
                  متقاضی: {requester?.full_name ?? "—"} {requester?.mobile ? `(${requester.mobile})` : ""}
                  {caseRow ? (
                    <>
                      {" "}· پرونده: <Link href={`/panel/cases/${caseRow.id}`}>{caseRow.code ?? "بدون کد"}</Link> · وضعیت:{" "}
                      {stateLabel(definition, caseRow.state)}
                    </>
                  ) : null}
                  {req.expires_at ? <> · انقضا: {relativeFa(req.expires_at)}</> : null}
                </div>
              </div>
              <div className="small">{toJalali(req.created_at)}</div>
            </div>

            <div className="kv">
              <div>
                <div className="k">محدوده متراژ</div>
                <div className="v small">
                  {faNumber(req.area_min ?? 0)} تا {faNumber(req.area_max ?? 0)} متر
                </div>
              </div>
              <div>
                <div className="k">بودجه</div>
                <div className="v small">
                  {faMoney(req.budget_min)} تا {faMoney(req.budget_max)}
                </div>
              </div>
              <div>
                <div className="k">محله‌ها</div>
                <div className="v small">{districts.length ? districts.join("، ") : "همه محله‌ها"}</div>
              </div>
              <div>
                <div className="k">تعداد اتاق</div>
                <div className="v small">{req.rooms === null ? "—" : faNumber(req.rooms)}</div>
              </div>
            </div>

            {req.description ? <p className="small muted">{req.description}</p> : null}

            <div className="flex-between">
              <h4 style={{ fontSize: 13.5, margin: "8px 0" }}>آگهی‌های متناسب ({faNumber(matches.length)})</h4>
              {openCase ? (
                <ActionForm
                  action={computeMatchesAction}
                  csrf={csrf}
                  hidden={{ caseId: openCase.id }}
                  submitLabel="تطبیق مجدد"
                  submitClass="secondary small"
                  compact
                />
              ) : null}
            </div>
            {matches.length ? (
              <table>
                <thead>
                  <tr>
                    <th>آگهی</th>
                    <th>امتیاز</th>
                    <th>دلیل</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((match) => {
                    const listing = Catalog.findListingById(match.listing_id);
                    return (
                      <tr key={match.id}>
                        <td className="small">
                          {listing
                            ? `${listing.deal_type === "rent" ? "اجاره" : "خرید"} · ${listing.city} — ${listing.district} · ${faNumber(listing.area ?? 0)} متر · ${
                                listing.deal_type === "rent" ? `${faMoney(listing.deposit)} ودیعه` : faMoney(listing.price)
                              }`
                            : match.listing_id}
                        </td>
                        <td>
                          <span className={`badge ${match.score >= 0.7 ? "success" : match.score >= 0.55 ? "info" : "muted"}`}>{match.score.toFixed(2)}</span>
                        </td>
                        <td className="small muted">{match.note ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="empty">هنوز تطبیقی ثبت نشده است.</div>
            )}

            {openCase ? (
              <div className="actions-row" style={{ marginTop: 10 }}>
                {openCase.state === "requirements_start" ? (
                  <>
                    {(["public", "agents", "staff"] as const).map((level) => (
                      <ActionForm
                        key={level}
                        action={transitionAction}
                        csrf={csrf}
                        hidden={{ caseId: openCase.id, transitionKey: "set_access_level", option: level }}
                        submitLabel={`نمایش: ${labelOf(ACCESS_LEVEL_LABELS, level)}`}
                        submitClass="secondary small"
                        compact
                      />
                    ))}
                  </>
                ) : null}
                {openCase.state === "requirements_visible" ? (
                  <ActionForm
                    action={transitionAction}
                    csrf={csrf}
                    hidden={{ caseId: openCase.id, transitionKey: "match_requirements" }}
                    submitLabel="شروع تطبیق"
                    submitClass="secondary small"
                    compact
                  />
                ) : null}
                {openCase.state === "requirements_matching" ? (
                  <ActionForm
                    action={transitionAction}
                    csrf={csrf}
                    hidden={{ caseId: openCase.id, transitionKey: "publish_matches" }}
                    submitLabel="انتشار تطبیق‌ها"
                    submitClass="success small"
                    compact
                  />
                ) : null}
                {openCase.state === "requirements_matched" ? (
                  <>
                    <ActionForm
                      action={transitionAction}
                      csrf={csrf}
                      hidden={{ caseId: openCase.id, transitionKey: "fulfill_requirement" }}
                      submitLabel="انجام شد"
                      submitClass="success small"
                      compact
                    />
                    <ActionForm
                      action={transitionAction}
                      csrf={csrf}
                      hidden={{ caseId: openCase.id, transitionKey: "back_to_visible" }}
                      submitLabel="بازگشت به حالت نمایش"
                      submitClass="secondary small"
                      compact
                    />
                  </>
                ) : null}
                {["requirements_visible", "requirements_matched"].includes(openCase.state) ? (
                  <>
                    <ActionForm
                      action={transitionAction}
                      csrf={csrf}
                      hidden={{ caseId: openCase.id, transitionKey: "expire_requirement" }}
                      submitLabel="انقضا"
                      submitClass="secondary small"
                      compact
                    />
                    <ActionForm
                      action={transitionAction}
                      csrf={csrf}
                      hidden={{ caseId: openCase.id, transitionKey: "cancel_requirement" }}
                      submitLabel="لغو"
                      submitClass="danger small"
                      compact
                    />
                  </>
                ) : null}
                <Link className="btn secondary small" href={`/panel/cases/${openCase.id}`}>
                  مدیریت پرونده
                </Link>
              </div>
            ) : null}
          </div>
        );
      })}

      {!requirements.length ? (
        <div className="card">
          <div className="empty">نیازمندی‌ای با این فیلترها یافت نشد.</div>
        </div>
      ) : null}
    </>
  );
}

export async function generateMetadata() {
  return { title: "نیازمندی‌ها — CRM املاک" };
}
