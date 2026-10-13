import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, getCsrfToken } from "@/auth/session";
import { can } from "@/auth/rbac";
import * as Cases from "@/db/repos/cases";
import * as Catalog from "@/db/repos/catalog";
import * as People from "@/db/repos/people";
import * as Svc from "@/domain/service/case-service";
import { AppError } from "@/lib/errors";
import { faMoney, faNumber } from "@/lib/money";
import { toJalali, toJalaliDateTime, relativeFa } from "@/lib/jalali";
import {
  ACCESS_LEVEL_LABELS,
  CONTRACT_TYPE_LABELS,
  DOCUMENT_STATUS_LABELS,
  LEGAL_RESULT_LABELS,
  LISTING_STATUS_LABELS,
  OUTPUT_MODE_LABELS,
  PARTY_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PRIORITY_LABELS,
  REQUIREMENT_STATUS_LABELS,
  SIGNATURE_STATUS_LABELS,
  TASK_STATUS_LABELS,
  TRACKING_STATUS_LABELS,
  labelOf,
} from "@/lib/fa-labels";
import { ActionForm, Field } from "../../forms";
import {
  addTaskAction,
  completeTaskAction,
  computeMatchesAction,
  markSignatureAction,
  reassignCaseAction,
  reviewDocumentAction,
  saveContractAction,
  saveListingAction,
  saveRequirementAction,
  transitionAction,
} from "../actions";

export const dynamic = "force-dynamic";

const PAYMENT_STATES = ["payment_direct", "payment_error", "subscription_check", "referral_check", "service_finance"];

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const csrf = await getCsrfToken();

  const actor = { type: session.role, id: session.staff.id, name: session.staff.full_name };

  let detail: ReturnType<typeof Svc.caseDetail>;
  try {
    detail = Svc.caseDetail(id, actor);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  const available = detail.available;
  const { row, runtime, stateInfo, definition } = detail;
  const staffList = People.listActiveStaff();
  const signatureParties = Svc.requiredSignaturesFor(runtime.contract ?? null);
  const openTasks = detail.tasks.filter((t) => t.status === "open" || t.status === "in_progress");
  const doneTasks = detail.tasks.filter((t) => t.status === "done");

  return (
    <>
      <div className="card">
        <div className="card-title-row">
          <div>
            <div className="flex wrap" style={{ alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>{row.title ?? row.code ?? row.id}</h2>
              <span className="badge">{stateInfo?.name ?? row.state}</span>
              <span className={`badge ${row.status === "closed" ? "muted" : "success"}`}>{row.status === "closed" ? "بسته" : "باز"}</span>
              <span className={`badge ${row.priority === "high" || row.priority === "urgent" ? "danger" : "muted"}`}>
                {labelOf(PRIORITY_LABELS, row.priority)}
              </span>
              {row.outcome ? <span className="badge info">نتیجه: {row.outcome}</span> : null}
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              کد پرونده: <span className="mono">{row.code ?? "—"}</span>
              {row.external_id ? (
                <>
                  {" "}· شناسه سرور اصلی: <span className="mono">{row.external_id}</span>
                </>
              ) : null}
              {" "}· ساخته‌شده: {toJalaliDateTime(row.created_at)}
              {row.due_at ? <> · سررسید: {relativeFa(row.due_at)}</> : null}
            </div>
          </div>
          <Link href="/panel/cases" className="btn secondary small">
            بازگشت به فهرست
          </Link>
        </div>

        <div className="kv" style={{ marginTop: 8 }}>
          <div>
            <div className="k">کاربر (مالک پرونده)</div>
            <div className="v">{detail.owner ? `${detail.owner.full_name} — ${detail.owner.mobile ?? "بدون موبایل"}` : "—"}</div>
          </div>
          <div>
            <div className="k">مشاور</div>
            <div className="v">{detail.agent?.full_name ?? "—"}</div>
          </div>
          <div>
            <div className="k">کارشناس مسئول</div>
            <div className="v">{detail.assignedStaff?.full_name ?? "تعیین‌نشده"}</div>
          </div>
          <div>
            <div className="k">خدمت</div>
            <div className="v">{runtime.settings.serviceName as string}</div>
          </div>
        </div>

        {can(session.role, "case.assign") ? (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <ActionForm
              action={reassignCaseAction}
              csrf={csrf}
              hidden={{ caseId: row.id }}
              submitLabel="به‌روزرسانی پرونده"
              submitClass="secondary small"
            >
              <div className="form-row">
                <Field
                  label="کارشناس مسئول"
                  name="assignedStaffId"
                  type="select"
                  defaultValue={row.assigned_staff_id ?? ""}
                  options={staffList.map((s) => ({ value: s.id, label: s.full_name }))}
                />
                <Field
                  label="اولویت"
                  name="priority"
                  type="select"
                  defaultValue={row.priority}
                  options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))}
                />
              </div>
            </ActionForm>
          </div>
        ) : null}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>اقدام بعدی</h3>
          {available.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {available.map((transition) => {
                const disabled = !transition.allowed;
                return (
                  <div key={transition.key} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                    <div className="flex-between wrap">
                      <div>
                        <div style={{ fontWeight: 600 }}>{transition.name}</div>
                        {transition.description ? <div className="small muted">{transition.description}</div> : null}
                        {!disabled && transition.options?.length ? (
                          <div className="small muted">
                            {transition.options
                              .filter((o) => o.allowed)
                              .map((o) => o.label)
                              .join(" / ")}
                          </div>
                        ) : null}
                        {disabled && transition.reason ? <div className="small" style={{ color: "var(--warning)" }}>{transition.reason}</div> : null}
                      </div>
                    </div>

                    {disabled ? null : transition.options?.length ? (
                      <div className="actions-row" style={{ marginTop: 10 }}>
                        {transition.options.map((option) =>
                          option.allowed ? (
                            <ActionForm
                              key={option.value}
                              action={transitionAction}
                              csrf={csrf}
                              hidden={{ caseId: row.id, transitionKey: transition.key, option: option.value }}
                              submitLabel={option.label}
                              submitClass="small"
                              compact
                            />
                          ) : (
                            <span key={option.value} className="badge muted" title={option.reason ?? ""}>
                              {option.label}
                            </span>
                          ),
                        )}
                      </div>
                    ) : (
                      <div style={{ marginTop: 10 }}>
                        <ActionForm
                          action={transitionAction}
                          csrf={csrf}
                          hidden={{ caseId: row.id, transitionKey: transition.key }}
                          submitLabel={`ثبت «${transition.name}»`}
                          submitClass="small"
                        >
                          <TransitionFields transitionKey={transition.key} requiresReason={transition.requiresReason} />
                        </ActionForm>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty">در این وضعیت گذار قابل اجرایی وجود ندارد.</div>
          )}

          {PAYMENT_STATES.includes(row.state) ? (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <h3 style={{ fontSize: 14 }}>ثبت پرداخت</h3>
              <ActionForm action={transitionAction} csrf={csrf} hidden={{ caseId: row.id, transitionKey: "payment_record" }} submitLabel="ثبت نتیجه پرداخت">
                <div className="form-row">
                  <Field
                    label="روش پرداخت"
                    name="method"
                    type="select"
                    defaultValue="direct"
                    options={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }))}
                  />
                  <Field
                    label="نتیجه (برای آزمون سندباکس)"
                    name="simulateFailure"
                    type="select"
                    defaultValue="false"
                    options={[
                      { value: "false", label: "موفق" },
                      { value: "true", label: "ناموفق (شبیه‌سازی)" },
                    ]}
                  />
                </div>
              </ActionForm>
            </div>
          ) : null}
        </div>

        <div className="card">
          <h3>وضعیت جهان پرونده</h3>
          <div className="kv">
            <div>
              <div className="k">کد رهگیری لازم است؟</div>
              <div className="v">{row.requires_tracking ? "بله" : "خیر"}</div>
            </div>
            <div>
              <div className="k">تلاش پرداخت / رهگیری</div>
              <div className="v">
                {faNumber(row.attempts_payment)} / {faNumber(row.attempts_tracking)}
              </div>
            </div>
            <div>
              <div className="k">سطح دسترسی</div>
              <div className="v">{labelOf(ACCESS_LEVEL_LABELS, row.access_level)}</div>
            </div>
            <div>
              <div className="k">فاکتورها</div>
              <div className="v">
                {detail.invoices.length
                  ? detail.invoices.map((inv) => `${faMoney(inv.amount)} (${inv.status === "paid" ? "پرداخت‌شده" : "پرداخت‌نشده"})`).join(" ، ")
                  : "—"}
              </div>
            </div>
            <div>
              <div className="k">نسخه تعریف گردش‌کار</div>
              <div className="v mono">
                {row.workflow_key}@v{row.workflow_version}
              </div>
            </div>
          </div>

          {detail.legalReviews.length ? (
            <div style={{ marginTop: 12 }}>
              <div className="k">آخرین بررسی حقوقی</div>
              <div className="v">
                {labelOf(LEGAL_RESULT_LABELS, detail.legalReviews[0].result)} — {detail.legalReviews[0].note ?? "بدون یادداشت"}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {detail.contract ? (
        <div className="card">
          <div className="card-title-row">
            <h3>اطلاعات قرارداد</h3>
            <div className="small muted">
              نوع: {labelOf(CONTRACT_TYPE_LABELS, detail.contract.contract_type)} · خروجی:{" "}
              {labelOf(OUTPUT_MODE_LABELS, detail.contract.output_mode)} · نسخه بندها: {faNumber(detail.contract.clause_version)}
              {detail.contract.document_generated_at ? ` · سند تولیدشده: ${toJalaliDateTime(detail.contract.document_generated_at)}` : ""}
            </div>
          </div>
          <ActionForm action={saveContractAction} csrf={csrf} hidden={{ caseId: row.id }} submitLabel="ذخیره اطلاعات قرارداد">
            <div className="form-row">
              <Field
                label="نوع قرارداد"
                name="contractType"
                type="select"
                defaultValue={detail.contract.contract_type}
                options={Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              />
              <Field
                label="خروجی موردنیاز"
                name="outputMode"
                type="select"
                defaultValue={detail.contract.output_mode}
                options={Object.entries(OUTPUT_MODE_LABELS).map(([value, label]) => ({ value, label }))}
              />
              <Field label="شهر" name="city" defaultValue={detail.contract.city} />
              <Field label="محله" name="district" defaultValue={detail.contract.district} />
              <Field label="متراژ" name="area" type="number" defaultValue={detail.contract.area} />
            </div>
            <Field label="نشانی ملک" name="propertyAddress" defaultValue={detail.contract.property_address} />
            <div className="form-row">
              <Field label="مالک (مؤجر)" name="landlordName" defaultValue={detail.contract.landlord_name} hint="برای قرارداد اجاره" />
              <Field label="مستأجر" name="tenantName" defaultValue={detail.contract.tenant_name} hint="برای قرارداد اجاره" />
              <Field label="فروشنده" name="sellerName" defaultValue={detail.contract.seller_name} hint="برای خرید و فروش" />
              <Field label="خریدار" name="buyerName" defaultValue={detail.contract.buyer_name} hint="برای خرید و فروش" />
            </div>
            <div className="form-row">
              <Field label="ودیعه (تومان)" name="depositAmount" type="number" defaultValue={detail.contract.deposit_amount} />
              <Field label="اجاره ماهانه (تومان)" name="rentAmount" type="number" defaultValue={detail.contract.rent_amount} />
              <Field label="مبلغ فروش (تومان)" name="salePrice" type="number" defaultValue={detail.contract.sale_price} />
              <Field label="تاریخ شروع (جلالی)" name="startDate" defaultValue={detail.contract.start_date} placeholder="۱۴۰۵/۰۷/۲۱" />
              <Field label="تاریخ پایان (جلالی)" name="endDate" defaultValue={detail.contract.end_date} placeholder="۱۴۰۶/۰۷/۲۰" />
            </div>
            <Field label="بندهای اختصاصی / یادداشت حقوقی" name="termsNote" type="textarea" defaultValue={detail.contract.terms_note} />
          </ActionForm>
        </div>
      ) : null}

      {detail.documents.length ? (
        <div className="card">
          <h3>مدارک</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>مدرک</th>
                  <th>وضعیت</th>
                  <th>یادداشت</th>
                  <th>اقدام</th>
                </tr>
              </thead>
              <tbody>
                {detail.documents.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.title}</td>
                    <td>
                      <span
                        className={`badge ${
                          doc.status === "approved" ? "success" : doc.status === "rejected" ? "danger" : doc.status === "incomplete" ? "warning" : "muted"
                        }`}
                      >
                        {labelOf(DOCUMENT_STATUS_LABELS, doc.status)}
                      </span>
                    </td>
                    <td className="small">{doc.review_note ?? "—"}</td>
                    <td>
                      <ActionForm
                        action={reviewDocumentAction}
                        csrf={csrf}
                        hidden={{ caseId: row.id, documentId: doc.id, status: "approved" }}
                        submitLabel="تأیید"
                        submitClass="success small"
                        compact
                      />
                      <ActionForm
                        action={reviewDocumentAction}
                        csrf={csrf}
                        hidden={{ caseId: row.id, documentId: doc.id, status: "rejected" }}
                        submitLabel="رد"
                        submitClass="danger small"
                        compact
                      />
                      <ActionForm
                        action={reviewDocumentAction}
                        csrf={csrf}
                        hidden={{ caseId: row.id, documentId: doc.id, status: "incomplete" }}
                        submitLabel="ناقص"
                        submitClass="secondary small"
                        compact
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="grid grid-2">
        {runtime.contract ? (
          <div className="card">
            <h3>امضای طرفین</h3>
            <p className="small muted">طرفین لازم برای این نوع قرارداد: {signatureParties.map((p) => labelOf(PARTY_LABELS, p)).join(" ، ")}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>طرف</th>
                    <th>وضعیت</th>
                    <th>ثبت امضا</th>
                  </tr>
                </thead>
                <tbody>
                  {signatureParties.map((party) => {
                    const existing = detail.signatures.find((s) => s.party === party);
                    return (
                      <tr key={party}>
                        <td>{labelOf(PARTY_LABELS, party)}</td>
                        <td>
                          <span className={`badge ${existing?.status === "signed" ? "success" : existing?.status === "declined" ? "danger" : "muted"}`}>
                            {labelOf(SIGNATURE_STATUS_LABELS, existing?.status ?? "pending")}
                          </span>
                        </td>
                        <td>
                          <ActionForm
                            action={markSignatureAction}
                            csrf={csrf}
                            hidden={{ caseId: row.id, party, status: "signed" }}
                            submitLabel="ثبت امضا"
                            submitClass="success small"
                            compact
                          />
                          <ActionForm
                            action={markSignatureAction}
                            csrf={csrf}
                            hidden={{ caseId: row.id, party, status: "declined" }}
                            submitLabel="امتناع"
                            submitClass="danger small"
                            compact
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="card">
          <h3>کد رهگیری</h3>
          {detail.tracking ? (
            <div className="kv">
              <div>
                <div className="k">وضعیت</div>
                <div className="v">{labelOf(TRACKING_STATUS_LABELS, detail.tracking.status)}</div>
              </div>
              <div>
                <div className="k">کد ثبت‌شده</div>
                <div className="v mono">{detail.tracking.code ?? "—"}</div>
              </div>
              <div>
                <div className="k">تعداد تلاش</div>
                <div className="v">{faNumber(detail.tracking.attempts)}</div>
              </div>
              <div>
                <div className="k">آخرین خطا</div>
                <div className="v">{detail.tracking.error ?? "—"}</div>
              </div>
            </div>
          ) : (
            <div className="empty">برای این پرونده درخواست کد رهگیری ثبت نشده است.</div>
          )}
          {row.state === "tracking_check" ? (
            <ActionForm
              action={transitionAction}
              csrf={csrf}
              hidden={{ caseId: row.id, transitionKey: "tracking_received" }}
              submitLabel="ثبت کد دریافتی از سامانه"
              submitClass="small"
            >
              <Field label="کد رهگیری سامانه املاک" name="code" placeholder="۱۴۰۵۱۲۳۴۵۶۷۸۹" />
            </ActionForm>
          ) : null}
        </div>
      </div>

      {detail.listing ? (
        <div className="card">
          <div className="card-title-row">
            <h3>اطلاعات آگهی</h3>
            <span className="badge info">{labelOf(LISTING_STATUS_LABELS, detail.listing.status)}</span>
          </div>
          <ActionForm action={saveListingAction} csrf={csrf} hidden={{ caseId: row.id }} submitLabel="ذخیره آگهی">
            <div className="form-row">
              <Field
                label="نوع معامله"
                name="dealType"
                type="select"
                defaultValue={detail.listing.deal_type}
                options={[
                  { value: "rent", label: "اجاره" },
                  { value: "sale", label: "خرید و فروش" },
                ]}
              />
              <Field label="نوع ملک" name="propertyType" defaultValue={detail.listing.property_type} placeholder="آپارتمان" />
              <Field label="شهر" name="city" defaultValue={detail.listing.city} />
              <Field label="محله" name="district" defaultValue={detail.listing.district} />
              <Field label="متراژ" name="area" type="number" defaultValue={detail.listing.area} />
              <Field label="تعداد اتاق" name="rooms" type="number" defaultValue={detail.listing.rooms} />
              <Field label="ودیعه (تومان)" name="deposit" type="number" defaultValue={detail.listing.deposit} />
              <Field label="اجاره ماهانه (تومان)" name="rent" type="number" defaultValue={detail.listing.rent} />
              <Field label="قیمت فروش (تومان)" name="price" type="number" defaultValue={detail.listing.price} />
            </div>
            <Field label="نشانی" name="address" defaultValue={detail.listing.address} />
            <Field label="توضیحات" name="description" type="textarea" defaultValue={detail.listing.description} />
            <Field
              label="تصاویر (هر خط یک آدرس)"
              name="images"
              type="textarea"
              defaultValue={(JSON.parse(detail.listing.images || "[]") as string[]).join("\n")}
            />
          </ActionForm>
          {detail.listing.expires_at ? <p className="small muted">انقضا: {toJalali(detail.listing.expires_at)}</p> : null}
        </div>
      ) : null}

      {detail.requirement ? (
        <div className="card">
          <div className="card-title-row">
            <h3>نیازمندی</h3>
            <span className="badge info">{labelOf(REQUIREMENT_STATUS_LABELS, detail.requirement.status)}</span>
          </div>
          <ActionForm action={saveRequirementAction} csrf={csrf} hidden={{ caseId: row.id }} submitLabel="ذخیره نیازمندی">
            <div className="form-row">
              <Field
                label="نوع معامله"
                name="dealType"
                type="select"
                defaultValue={detail.requirement.deal_type}
                options={[
                  { value: "rent", label: "اجاره" },
                  { value: "sale", label: "خرید و فروش" },
                ]}
              />
              <Field label="نوع ملک" name="propertyType" defaultValue={detail.requirement.property_type} />
              <Field label="شهر" name="city" defaultValue={detail.requirement.city} />
              <Field label="محله‌ها (هر خط یا با کاما)" name="districts" defaultValue={(JSON.parse(detail.requirement.districts || "[]") as string[]).join("\n")} />
              <Field label="حداقل متراژ" name="areaMin" type="number" defaultValue={detail.requirement.area_min} />
              <Field label="حداکثر متراژ" name="areaMax" type="number" defaultValue={detail.requirement.area_max} />
              <Field label="حداقل بودجه" name="budgetMin" type="number" defaultValue={detail.requirement.budget_min} />
              <Field label="حداکثر بودجه" name="budgetMax" type="number" defaultValue={detail.requirement.budget_max} />
              <Field label="تعداد اتاق" name="rooms" type="number" defaultValue={detail.requirement.rooms} />
            </div>
            <Field label="توضیحات" name="description" type="textarea" defaultValue={detail.requirement.description} />
          </ActionForm>

          <div className="flex-between" style={{ marginTop: 10 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>آگهی‌های متناسب</h3>
            <ActionForm action={computeMatchesAction} csrf={csrf} hidden={{ caseId: row.id }} submitLabel="اجرای تطبیق مجدد" submitClass="secondary small" compact />
          </div>
          {detail.matches.length ? (
            <table>
              <thead>
                <tr>
                  <th>آگهی</th>
                  <th>امتیاز</th>
                  <th>دلیل</th>
                </tr>
              </thead>
              <tbody>
                {detail.matches.map((match) => {
                  const listing = Catalog.findListingById(match.listing_id);
                  return (
                    <tr key={match.id}>
                      <td>
                        {listing ? (
                          <Link href={`/panel/listings?q=${encodeURIComponent(listing.district ?? "")}`}>
                            {listing.city} — {listing.district} — {faNumber(listing.area ?? 0)} متر
                          </Link>
                        ) : (
                          match.listing_id
                        )}
                      </td>
                      <td>{match.score}</td>
                      <td className="small muted">{match.note ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty">هنوز تطبیقی ثبت نشده است.</div>
          )}
        </div>
      ) : null}

      <div className="grid grid-2">
        <div className="card">
          <h3>تایم‌لاین پرونده</h3>
          {detail.timeline.length ? (
            <ul className="timeline">
              {detail.timeline.map((event) => (
                <li key={event.id} className={event.visibility === "external" ? "external" : ""}>
                  <div className="t-title">{event.title}</div>
                  {event.body ? <div className="small">{event.body}</div> : null}
                  <div className="t-meta">
                    {toJalaliDateTime(event.at)} · {relativeFa(event.at)}
                    {event.actor_name ? ` · ${event.actor_name}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">رویدادی ثبت نشده است.</div>
          )}
        </div>

        <div className="card">
          <h3>وظایف</h3>
          {openTasks.length ? (
            <table>
              <thead>
                <tr>
                  <th>وظیفه</th>
                  <th>سررسید</th>
                  <th>بستن</th>
                </tr>
              </thead>
              <tbody>
                {openTasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      {task.title}
                      {task.description ? <div className="small muted">{task.description}</div> : null}
                    </td>
                    <td className="small">{task.due_at ? relativeFa(task.due_at) : "—"}</td>
                    <td>
                      <ActionForm
                        action={completeTaskAction}
                        csrf={csrf}
                        hidden={{ taskId: task.id, caseId: row.id }}
                        submitLabel="انجام شد"
                        submitClass="success small"
                        compact
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">وظیفه بازی ندارد.</div>
          )}
          {doneTasks.length ? <p className="small muted">{faNumber(doneTasks.length)} وظیفه انجام‌شده ثبت شده است.</p> : null}

          <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <ActionForm action={addTaskAction} csrf={csrf} hidden={{ caseId: row.id }} submitLabel="افزودن وظیفه" submitClass="secondary small">
              <div className="form-row">
                <Field label="عنوان" name="title" required />
                <Field
                  label="اولویت"
                  name="priority"
                  type="select"
                  defaultValue="normal"
                  options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))}
                />
                <Field label="سررسید" name="dueAt" type="datetime-local" />
              </div>
              <Field label="توضیح" name="description" type="textarea" rows={2} />
            </ActionForm>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>گذارهای ثبت‌شده</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>از</th>
                <th>به</th>
                <th>گذار</th>
                <th>گزینه</th>
                <th>کاربر</th>
                <th>دلیل</th>
                <th>زمان</th>
              </tr>
            </thead>
            <tbody>
              {detail.transitions.map((transition) => (
                <tr key={transition.id}>
                  <td>{definition.states.find((s) => s.key === transition.from_state)?.name ?? transition.from_state}</td>
                  <td>{definition.states.find((s) => s.key === transition.to_state)?.name ?? transition.to_state}</td>
                  <td className="small">{transition.transition_name}</td>
                  <td className="small">{transition.option ?? "—"}</td>
                  <td className="small">{transition.actor_name ?? transition.actor_type}</td>
                  <td className="small">{transition.reason ?? "—"}</td>
                  <td className="small">{toJalaliDateTime(transition.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function TransitionFields({ transitionKey, requiresReason }: { transitionKey: string; requiresReason: boolean }) {
  const decisionFor: Record<string, Array<{ value: string; label: string }>> = {
    legal_approved: [{ value: "approved", label: "تأیید حقوقی" }],
    legal_needs_edit: [{ value: "needs_edit", label: "نیازمند ویرایش" }],
    legal_rejected: [{ value: "rejected", label: "رد" }],
    listing_approved: [{ value: "approved", label: "تأیید آگهی" }],
    listing_needs_fix: [{ value: "needs_fix", label: "نیازمند اصلاح" }],
    service_approved: [{ value: "approved", label: "تأیید نتیجه خدمت" }],
    service_fix_requested: [{ value: "needs_fix", label: "درخواست اصلاح" }],
  };

  return (
    <>
      {decisionFor[transitionKey] ? (
        <Field label="نتیجه بررسی" name="decision" type="select" defaultValue={decisionFor[transitionKey][0].value} options={decisionFor[transitionKey]} />
      ) : null}
      {transitionKey === "clause_edit_done" ? <Field label="شرح اصلاح بندها" name="revisionNote" required /> : null}
      {transitionKey === "tracking_received" ? <Field label="کد رهگیری سامانه" name="code" required /> : null}
      {["documents_incomplete", "documents_rejected", "service_fix_requested"].includes(transitionKey) ? (
        <Field
          label="ساخت وظیفه پیگیری برای نقص؟"
          name="needsFollowup"
          type="select"
          defaultValue="true"
          options={[
            { value: "true", label: "بله" },
            { value: "false", label: "خیر" },
          ]}
        />
      ) : null}
      {requiresReason ? <Field label="دلیل (اجباری)" name="reason" type="textarea" rows={2} required /> : null}
    </>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = Cases.findCaseById(id);
  return { title: row ? `${row.title ?? row.code ?? "پرونده"} — CRM املاک` : "پرونده — CRM املاک" };
}
