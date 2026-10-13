import { requireSession, getCsrfToken } from "@/auth/session";
import { can } from "@/auth/rbac";
import * as People from "@/db/repos/people";
import * as Catalog from "@/db/repos/catalog";
import * as Referrals from "@/db/repos/referrals";
import * as Svc from "@/domain/service/referral-service";
import {
  KANBAN_STATUS_LABELS,
  KANBAN_STATUS_ORDER,
  PRIORITY_LABELS,
  SERVICE_KIND_LABELS,
  INBOX_KIND_LABELS,
} from "@/lib/fa-labels";
import { faNumber } from "@/lib/money";
import { KanbanBoard } from "./kanban-board";
import { ActionForm, Field } from "../forms";
import { createKanbanCardAction, manageOrgUnitAction } from "./actions";
import type { UnitOption } from "@/components/ops/quick-actions";

export const dynamic = "force-dynamic";

function str(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export default async function KanbanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const csrf = await getCsrfToken();
  const isAdmin = can(session.role, "referral.manage");
  const params = await searchParams;

  const filter = {
    serviceKey: str(params.service),
    unitKey: str(params.unit),
    staffId: str(params.staff),
    kanbanStatus: str(params.status),
    priority: str(params.priority),
    due: str(params.due) as "overdue" | "today" | "week" | "none" | undefined,
    search: str(params.q),
    mine: params.mine === "1",
    unassigned: params.unassigned === "1",
  };

  const board = Svc.buildBoard(
    { id: session.staff.id, role: session.role, unit: session.staff.org_unit ?? null, name: session.staff.full_name },
    filter,
  );

  const staffList = People.listActiveStaff().map((s) => {
    const unit = s.org_unit ? Referrals.getOrgUnit(s.org_unit) : null;
    return { id: s.id, fullName: s.full_name, title: s.title, unitKey: s.org_unit, unitName: unit?.name ?? null };
  });
  const unitsWithStaff: UnitOption[] = board.units.map((unit) => ({
    key: unit.key,
    name: unit.name,
    description: unit.description,
    staff: staffList.filter((s) => s.unitKey === unit.key).map((s) => ({ id: s.id, fullName: s.fullName, title: s.title })),
  }));

  const services = Catalog.listServices(true).map((s) => ({ value: s.key, label: s.name }));
  const staffOptions = staffList.map((s) => ({ value: s.id, label: `${s.fullName}${s.unitName ? ` — ${s.unitName}` : ""}` }));

  return (
    <>
      <div className="card">
        <div className="card-title-row">
          <div>
            <h2 style={{ margin: 0 }}>کانبان عملیات</h2>
            <div className="small muted">
              ستون‌ها = واحدهای سازمانی (از کاتالوگ واحدها) · کارت‌ها = عملیات واقعی پرونده‌ها · وضعیت، اولویت و مهلت فیلدهای مستقل هر کارت‌اند.
            </div>
          </div>
          <span className="small muted">{faNumber(board.stats.total)} کارت</span>
        </div>

        <div className="ops-stats">
          <span className="badge muted">کل: {faNumber(board.stats.total)}</span>
          <span className="badge danger">عقب‌افتاده: {faNumber(board.stats.overdue)}</span>
          <span className="badge warning">بدون مسئول: {faNumber(board.stats.unassigned)}</span>
          <span className="badge info">پیام خوانده‌نشده: {faNumber(board.stats.unreadMessages)}</span>
          <span className="badge success">انجام‌شده: {faNumber(board.stats.done)}</span>
          <span className="badge danger">لغوشده: {faNumber(board.stats.cancelled)}</span>
        </div>

        {/* فیلترها — همه سمت سرور روی کوئری تخته اعمال می‌شوند */}
        <form method="get" className="filters">
          <Field label="جست‌وجو (شناسه پرونده / کد / عنوان)" name="q" defaultValue={filter.search} placeholder="CRM-1405-…" />
          <div className="field">
            <label htmlFor="f-service">نوع خدمت</label>
            <select id="f-service" name="service" defaultValue={filter.serviceKey ?? ""}>
              <option value="">همه خدمات</option>
              {services.map((service) => (
                <option key={service.value} value={service.value}>
                  {service.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-unit">واحد</label>
            <select id="f-unit" name="unit" defaultValue={filter.unitKey ?? ""}>
              <option value="">همه واحدها</option>
              {board.units.map((unit) => (
                <option key={unit.key} value={unit.key}>
                  {unit.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-staff">مسئول</label>
            <select id="f-staff" name="staff" defaultValue={filter.staffId ?? ""}>
              <option value="">همه کارکنان</option>
              {staffOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-status">وضعیت عملیات</label>
            <select id="f-status" name="status" defaultValue={filter.kanbanStatus ?? ""}>
              <option value="">همه وضعیت‌ها</option>
              {KANBAN_STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {KANBAN_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-priority">اولویت</label>
            <select id="f-priority" name="priority" defaultValue={filter.priority ?? ""}>
              <option value="">همه اولویت‌ها</option>
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-due">مهلت</label>
            <select id="f-due" name="due" defaultValue={filter.due ?? ""}>
              <option value="">همه</option>
              <option value="overdue">عقب‌افتاده</option>
              <option value="today">تا ۲۴ ساعت آینده</option>
              <option value="week">تا یک هفته آینده</option>
              <option value="none">بدون مهلت</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-mine">فیلترهای سریع</label>
            <div className="flex wrap" style={{ gap: 10 }}>
              <label className="checkline">
                <input type="checkbox" name="mine" value="1" defaultChecked={filter.mine} /> فقط من
              </label>
              <label className="checkline">
                <input type="checkbox" name="unassigned" value="1" defaultChecked={filter.unassigned} /> بدون مسئول
              </label>
            </div>
          </div>
          <div className="field">
            <label htmlFor="f-apply">&nbsp;</label>
            <button type="submit" id="f-apply">
              اعمال فیلتر
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>ایجاد کارت عملیات جدید (ورودی ویزارد خدمات)</h3>
        <ActionForm action={createKanbanCardAction} csrf={csrf} submitLabel="ایجاد کارت در واحد من">
          <div className="form-row">
            <Field label="خدمت" name="serviceKey" type="select" required options={services} emptyLabel="انتخاب خدمت…" />
            <Field label="عنوان" name="title" required placeholder="مثلاً قرارداد اجاره واحد ۱۲" />
            <Field
              label="اولویت"
              name="priority"
              type="select"
              defaultValue="normal"
              options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))}
            />
            <Field label="مهلت (جلالی یا میلادی)" name="dueAt" placeholder="۱۴۰۵/۰۷/۳۰" />
          </div>
          <Field label="شرح کوتاه عملیات" name="description" placeholder="خروجی و توضیح کوتاه برای کارکنان" />
        </ActionForm>
      </div>

      <KanbanBoard board={board} csrf={csrf} units={unitsWithStaff} staff={staffList} />

      <div className="card">
        <h3>راهنمای وضعیت‌ها و اعلان‌های عملیات</h3>
        <div className="grid grid-2">
          <div>
            <div className="small muted">وضعیت‌های عملیات (مستقل از واحد):</div>
            <ul className="small">
              {KANBAN_STATUS_ORDER.map((status) => (
                <li key={status}>
                  <b>{KANBAN_STATUS_LABELS[status]}</b> — کلید <span className="mono">{status}</span>
                </li>
              ))}
            </ul>
            <div className="small muted">
              نوع خدمت‌ها: {Object.entries(SERVICE_KIND_LABELS).map(([, label]) => label).join(" · ")}
            </div>
          </div>
          <div>
            <div className="small muted">اعلان‌های داخلی مرتبط:</div>
            <ul className="small">
              {Object.entries(INBOX_KIND_LABELS).map(([kind, label]) => (
                <li key={kind}>
                  {label} <span className="mono muted small">({kind})</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {isAdmin ? (
        <div className="card">
          <h3>مدیریت واحدهای سازمانی (ستون‌های کانبان)</h3>
          <div className="grid grid-2">
            {board.units.map((u) => (
              <div key={u.key} className="unit-edit">
                <ActionForm
                  action={manageOrgUnitAction}
                  csrf={csrf}
                  hidden={{ op: "update", unitId: u.key }}
                  submitLabel="ذخیره"
                  submitClass="secondary small"
                >
                  <div className="form-row">
                    <Field label="کلید" name="key" defaultValue={u.key} required />
                    <Field label="نام" name="name" defaultValue={u.name} required />
                    <Field label="ترتیب" name="sortOrder" type="number" defaultValue={0} />
                  </div>
                  <Field label="توضیحات" name="description" defaultValue={u.description ?? ""} />
                </ActionForm>
                <ActionForm
                  action={manageOrgUnitAction}
                  csrf={csrf}
                  hidden={{ op: "delete", unitId: u.key }}
                  submitLabel="حذف"
                  submitClass="danger small"
                  compact
                />
              </div>
            ))}
          </div>
          <div className="unit-edit" style={{ marginTop: 12 }}>
            <h4 style={{ margin: "0 0 8px" }}>واحد جدید</h4>
            <ActionForm action={manageOrgUnitAction} csrf={csrf} hidden={{ op: "create" }} submitLabel="ایجاد واحد">
              <div className="form-row">
                <Field label="کلید (انگلیسی)" name="key" required placeholder="technical" />
                <Field label="نام" name="name" required placeholder="واحد فنی" />
                <Field label="ترتیب" name="sortOrder" type="number" defaultValue={0} />
              </div>
              <Field label="توضیحات" name="description" />
            </ActionForm>
          </div>
        </div>
      ) : null}
    </>
  );
}
