import Link from "next/link";
import { requireSession, getCsrfToken } from "@/auth/session";
import * as Cases from "@/db/repos/cases";
import * as Catalog from "@/db/repos/catalog";
import * as People from "@/db/repos/people";
import { loadDefinition } from "@/domain/workflows";
import { toJalali, relativeFa } from "@/lib/jalali";
import { faNumber } from "@/lib/money";
import { PRIORITY_LABELS, SERVICE_CATEGORY_LABELS, labelOf, stateLabel } from "@/lib/fa-labels";
import { ActionForm, Field } from "../forms";
import { createCaseAction } from "./actions";

export const dynamic = "force-dynamic";

const WORKFLOW_OF: Record<string, string> = {
  contract: "contract",
  listing: "listing",
  requirements: "requirements",
  custom: "custom_service",
};

export default async function CasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const csrf = await getCsrfToken();
  const params = await searchParams;

  const state = typeof params.state === "string" ? params.state : undefined;
  const service = typeof params.service === "string" ? params.service : undefined;
  const status = typeof params.status === "string" ? params.status : undefined;
  const priority = typeof params.priority === "string" ? params.priority : undefined;
  const q = typeof params.q === "string" ? params.q : undefined;
  const mine = params.mine === "1";

  const cases = Cases.listCases({
    state,
    serviceKey: service,
    status,
    priority,
    search: q,
    assignedStaffId: mine ? session.staff.id : undefined,
    limit: 100,
  });

  const services = Catalog.listServices(true);
  const users = People.listUsers({ limit: 300 });

  const statesForFilter = service
    ? loadDefinition(WORKFLOW_OF[services.find((s) => s.key === service)?.category ?? "contract"] ?? "contract", 1).states
    : [
        ...loadDefinition("contract", 1).states,
        ...loadDefinition("listing", 1).states,
        ...loadDefinition("requirements", 1).states,
        ...loadDefinition("custom_service", 1).states,
      ];

  const definitions = new Map(
    ["contract", "listing", "requirements", "custom_service"].map((key) => [key, loadDefinition(key, 1)] as const),
  );
  const defForRow = (serviceKey: string) => {
    const svc = services.find((s) => s.key === serviceKey);
    return definitions.get(WORKFLOW_OF[svc?.category ?? "contract"] ?? "contract") ?? null;
  };

  return (
    <>
      <div className="card">
        <div className="card-title-row">
          <h2 style={{ margin: 0 }}>پرونده‌ها</h2>
          <span className="small muted">{faNumber(cases.length)} مورد نمایش داده می‌شود</span>
        </div>
        <form method="get" className="filters">
          <Field label="جستجو (کد / عنوان)" name="q" defaultValue={q} placeholder="CRM-1405-…" />
          <div className="field">
            <label htmlFor="f-q-submit">&nbsp;</label>
            <button type="submit" id="f-q-submit">
              اعمال فیلتر
            </button>
          </div>
          <div className="field">
            <label htmlFor="f-service">خدمت</label>
            <select id="f-service" name="service" defaultValue={service ?? ""}>
              <option value="">همه خدمات</option>
              {services.map((svc) => (
                <option key={svc.key} value={svc.key}>
                  {svc.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-state">وضعیت گردش‌کار</label>
            <select id="f-state" name="state" defaultValue={state ?? ""}>
              <option value="">همه وضعیت‌ها</option>
              {statesForFilter.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-status">وضعیت پرونده</label>
            <select id="f-status" name="status" defaultValue={status ?? ""}>
              <option value="">همه</option>
              <option value="open">باز</option>
              <option value="closed">بسته</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-priority">اولویت</label>
            <select id="f-priority" name="priority" defaultValue={priority ?? ""}>
              <option value="">همه</option>
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-mine">فقط پرونده‌های من</label>
            <select id="f-mine" name="mine" defaultValue={mine ? "1" : ""}>
              <option value="">خیر</option>
              <option value="1">بله</option>
            </select>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>تشکیل پرونده جدید</h3>
        <ActionForm action={createCaseAction} csrf={csrf} submitLabel="تشکیل پرونده و ورود به پرونده">
          <div className="form-row">
            <Field
              label="خدمت"
              name="serviceKey"
              type="select"
              required
              options={services.map((svc) => ({
                value: svc.key,
                label: `${svc.name} — ${labelOf(SERVICE_CATEGORY_LABELS, svc.category)}`,
              }))}
            />
            <Field label="عنوان پرونده" name="title" placeholder="مثلاً قرارداد اجاره سعادت‌آباد" />
            <Field
              label="اولویت"
              name="priority"
              type="select"
              defaultValue="normal"
              options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))}
            />
            <Field
              label="کاربر (سینک‌شده)"
              name="ownerUserId"
              type="select"
              options={users.map((u) => ({ value: u.id, label: `${u.full_name}${u.mobile ? ` — ${u.mobile}` : ""}` }))}
            />
          </div>
          <Field label="یادداشت پذیرش" name="note" type="textarea" rows={2} />
        </ActionForm>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>کد</th>
                <th>عنوان</th>
                <th>خدمت</th>
                <th>وضعیت</th>
                <th>کاربر</th>
                <th>کارشناس</th>
                <th>اولویت</th>
                <th>سررسید</th>
                <th>آخرین تغییر</th>
              </tr>
            </thead>
            <tbody>
              {cases.length ? (
                cases.map((row) => {
                  const definition = defForRow(row.service_key);
                  const owner = row.owner_user_id ? People.findUserById(row.owner_user_id) : null;
                  const staff = row.assigned_staff_id ? People.findStaffById(row.assigned_staff_id) : null;
                  const serviceInfo = services.find((s) => s.key === row.service_key);
                  return (
                    <tr key={row.id}>
                      <td className="mono">
                        <Link href={`/panel/cases/${row.id}`}>{row.code ?? row.id.slice(-6)}</Link>
                      </td>
                      <td>{row.title ?? "—"}</td>
                      <td className="small">{serviceInfo?.name ?? row.service_key}</td>
                      <td>
                        <span className={`badge ${row.status === "closed" ? "muted" : "info"}`}>{stateLabel(definition, row.state)}</span>
                      </td>
                      <td className="small">{owner?.full_name ?? "—"}</td>
                      <td className="small">{staff?.full_name ?? "—"}</td>
                      <td>
                        <span className={`badge ${row.priority === "high" || row.priority === "urgent" ? "danger" : "muted"}`}>
                          {labelOf(PRIORITY_LABELS, row.priority)}
                        </span>
                      </td>
                      <td className="small">{row.due_at ? relativeFa(row.due_at) : "—"}</td>
                      <td className="small">{toJalali(row.last_transition_at ?? row.updated_at)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="empty">
                    پرونده‌ای با این فیلترها یافت نشد.
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
