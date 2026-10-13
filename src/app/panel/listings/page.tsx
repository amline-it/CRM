import Link from "next/link";
import { requireSession, getCsrfToken } from "@/auth/session";
import * as Catalog from "@/db/repos/catalog";
import * as Cases from "@/db/repos/cases";
import * as People from "@/db/repos/people";
import { loadDefinition } from "@/domain/workflows";
import { toJalali, relativeFa } from "@/lib/jalali";
import { faMoney, faNumber } from "@/lib/money";
import { LISTING_STATUS_LABELS, labelOf, stateLabel } from "@/lib/fa-labels";
import { ActionForm, Field } from "../forms";
import { transitionAction } from "../cases/actions";

export const dynamic = "force-dynamic";

function money(listing: Catalog.ListingRow): string {
  return listing.deal_type === "rent"
    ? `${faMoney(listing.deposit)} ودیعه / ${faMoney(listing.rent)} اجاره`
    : faMoney(listing.price);
}

export default async function ListingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();
  const csrf = await getCsrfToken();
  const params = await searchParams;
  const status = typeof params.status === "string" && params.status ? params.status : undefined;
  const q = typeof params.q === "string" ? params.q : undefined;

  const listings = Catalog.listListings({ status, search: q, limit: 300 });
  const definition = loadDefinition("listing", 1);
  const all = Catalog.listListings({ limit: 1000 });
  const countByStatus = (key: string) => all.filter((l) => l.status === key).length;

  return (
    <>
      <div className="grid grid-4">
        <div className="stat">
          <div className="k">کل آگهی‌ها</div>
          <div className="v">{faNumber(all.length)}</div>
        </div>
        <div className="stat">
          <div className="k">در انتظار بررسی</div>
          <div className="v">{faNumber(countByStatus("pending_review"))}</div>
        </div>
        <div className="stat">
          <div className="k">منتشرشده</div>
          <div className="v">{faNumber(countByStatus("published"))}</div>
        </div>
        <div className="stat">
          <div className="k">منقضی</div>
          <div className="v">{faNumber(countByStatus("expired"))}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2 style={{ margin: 0 }}>آگهی‌ها</h2>
          <span className="small muted">چرخه آگهی روی پرونده متناظر اجرا می‌شود؛ تأیید و انتشار از همین صفحه انجام می‌شود.</span>
        </div>
        <form method="get" className="filters">
          <Field label="جستجو (شهر / محله / نشانی)" name="q" defaultValue={q} />
          <div className="field">
            <label htmlFor="f-status">وضعیت آگهی</label>
            <select id="f-status" name="status" defaultValue={status ?? ""}>
              <option value="">همه</option>
              {Object.entries(LISTING_STATUS_LABELS).map(([value, label]) => (
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

      {listings.map((listing) => {
        const caseRow = listing.case_id ? Cases.findCaseById(listing.case_id) : null;
        const owner = listing.owner_user_id ? People.findUserById(listing.owner_user_id) : null;
        const agent = listing.agent_user_id ? People.findUserById(listing.agent_user_id) : null;
        const images = JSON.parse(listing.images || "[]") as string[];
        const canTransition = caseRow && caseRow.status !== "closed";

        return (
          <div className="card" key={listing.id}>
            <div className="card-title-row">
              <div>
                <h3 style={{ margin: 0 }}>
                  {listing.deal_type === "rent" ? "اجاره" : "خرید"} · {listing.property_type} · {listing.city} — {listing.district}
                  <span className={`badge ${listing.status === "published" ? "success" : listing.status === "pending_review" ? "warning" : "muted"}`}>
                    {labelOf(LISTING_STATUS_LABELS, listing.status)}
                  </span>
                </h3>
                <div className="small muted">
                  {caseRow ? (
                    <>
                      پرونده:{" "}
                      <Link href={`/panel/cases/${caseRow.id}`}>{caseRow.code ?? "بدون کد"}</Link> · وضعیت گردش‌کار: {stateLabel(definition, caseRow.state)}
                    </>
                  ) : (
                    "بدون پرونده (وارد‌شده از سرور اصلی)"
                  )}
                  {listing.external_id ? <> · شناسه خارجی: <span className="mono">{listing.external_id}</span></> : null}
                </div>
              </div>
              <div className="small">{money(listing)}</div>
            </div>

            <div className="kv">
              <div>
                <div className="k">متراژ / اتاق</div>
                <div className="v">
                  {faNumber(listing.area ?? 0)} متر · {listing.rooms === null ? "—" : `${faNumber(listing.rooms)} اتاق`}
                </div>
              </div>
              <div>
                <div className="k">مالک</div>
                <div className="v">{owner?.full_name ?? "—"}</div>
              </div>
              <div>
                <div className="k">مشاور</div>
                <div className="v">{agent?.full_name ?? "—"}</div>
              </div>
              <div>
                <div className="k">انتشار / انقضا</div>
                <div className="v small">
                  {listing.published_at ? toJalali(listing.published_at) : "منتشر نشده"}
                  {" · "}
                  {listing.expires_at ? relativeFa(listing.expires_at) : "بدون انقضا"}
                </div>
              </div>
              <div>
                <div className="k">بازدید</div>
                <div className="v">{faNumber(listing.views)}</div>
              </div>
            </div>

            {listing.address ? <p className="small">نشانی: {listing.address}</p> : null}
            {listing.description ? <p className="small muted">{listing.description}</p> : null}
            {listing.reject_reason ? <div className="alert error">دلیل رد/اصلاح: {listing.reject_reason}</div> : null}
            {images.length ? (
              <div className="small muted" style={{ direction: "ltr", overflowX: "auto", whiteSpace: "nowrap" }}>
                {images.map((src) => (
                  <span key={src} className="mono" style={{ marginInlineEnd: 8 }}>
                    {src}
                  </span>
                ))}
              </div>
            ) : null}

            {canTransition && caseRow ? (
              <div className="actions-row" style={{ marginTop: 8 }}>
                {caseRow.state === "listing_review" ? (
                  <ActionForm
                    action={transitionAction}
                    csrf={csrf}
                    hidden={{ caseId: caseRow.id, transitionKey: "listing_expert_decision", decision: "approved" }}
                    submitLabel="ثبت نظر کارشناس"
                    submitClass="secondary small"
                    compact
                  />
                ) : null}
                {caseRow.state === "listing_result" ? (
                  <>
                    <ActionForm
                      action={transitionAction}
                      csrf={csrf}
                      hidden={{ caseId: caseRow.id, transitionKey: "listing_approved" }}
                      submitLabel="تأیید و انتشار"
                      submitClass="success small"
                      compact
                    />
                    <ActionForm
                      action={transitionAction}
                      csrf={csrf}
                      hidden={{ caseId: caseRow.id, transitionKey: "listing_needs_fix" }}
                      submitLabel="نیازمند اصلاح"
                      submitClass="secondary small"
                      compact
                    />
                  </>
                ) : null}
                {caseRow.state === "listing_published" ? (
                  <ActionForm
                    action={transitionAction}
                    csrf={csrf}
                    hidden={{ caseId: caseRow.id, transitionKey: "listing_pause" }}
                    submitLabel="توقف انتشار"
                    submitClass="secondary small"
                    compact
                  />
                ) : null}
                {caseRow.state === "listing_paused" ? (
                  <ActionForm
                    action={transitionAction}
                    csrf={csrf}
                    hidden={{ caseId: caseRow.id, transitionKey: "listing_resume" }}
                    submitLabel="ازسرگیری انتشار"
                    submitClass="success small"
                    compact
                  />
                ) : null}
                {["listing_published", "listing_paused"].includes(caseRow.state) ? (
                  <ActionForm
                    action={transitionAction}
                    csrf={csrf}
                    hidden={{ caseId: caseRow.id, transitionKey: "listing_close" }}
                    submitLabel="بستن آگهی"
                    submitClass="danger small"
                    compact
                  />
                ) : null}
                <Link className="btn secondary small" href={`/panel/cases/${caseRow.id}`}>
                  مدیریت پرونده
                </Link>
              </div>
            ) : null}
          </div>
        );
      })}

      {!listings.length ? (
        <div className="card">
          <div className="empty">آگهی‌ای با این فیلترها یافت نشد.</div>
        </div>
      ) : null}
    </>
  );
}

export async function generateMetadata() {
  return { title: "آگهی‌ها — CRM املاک" };
}
