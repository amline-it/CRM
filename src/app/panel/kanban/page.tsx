import { requireSession, getCsrfToken } from "@/auth/session";
import { can } from "@/auth/rbac";
import * as People from "@/db/repos/people";
import * as Catalog from "@/db/repos/catalog";
import * as Referrals from "@/db/repos/referrals";
import * as Svc from "@/domain/service/referral-service";
import { KanbanBoard } from "./kanban-board";
import { ActionForm, Field } from "../forms";
import { createKanbanCardAction, manageOrgUnitAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const session = await requireSession();
  const csrf = await getCsrfToken();
  const isAdmin = can(session.role, "referral.manage");

  const actorUnit = session.staff.org_unit ?? null;
  const board = Svc.buildBoard({
    id: session.staff.id,
    role: session.role,
    unit: actorUnit,
    name: session.staff.full_name,
  });

  const staffList = People.listActiveStaff()
    .map((s) => {
      const unit = s.org_unit ? Referrals.getOrgUnit(s.org_unit) : null;
      return { id: s.id, fullName: s.full_name, title: s.title, unitKey: s.org_unit, unitName: unit?.name ?? null };
    })
    .filter((s) => s.unitKey);

  const services = Catalog.listServices(true).map((s) => ({ value: s.key, label: s.name }));

  return (
    <>
      <div className="card">
        <div className="card-title-row">
          <h2 style={{ margin: 0 }}>کانبان ارجاع درون‌سازمانی</h2>
          <span className="small muted">ستون‌ها = واحدها · کارت‌ها = خدمات ارجاع‌شده · وضعیت = مرحله بررسی</span>
        </div>
        <ol className="flow-steps">
          <li>ویزارد مدیریت خدمت</li>
          <li>باکس اقدام سریع</li>
          <li>نوع ارجاع (همکار / واحد)</li>
          <li>تشخیص واحد سازمانی</li>
          <li>اعتبارسنجی و ثبت ارجاع</li>
          <li>ثبت تاریخچه و مسیر</li>
          <li>انتقال کارت به ستون مقصد</li>
          <li>اقدام مسئول جدید</li>
        </ol>
      </div>

      <div className="card">
        <h3>ایجاد کارت خدمت جدید (ورودی ویزارد)</h3>
        <ActionForm action={createKanbanCardAction} csrf={csrf} submitLabel="ایجاد کارت در واحد من">
          <div className="form-row">
            <Field label="خدمت" name="serviceKey" type="select" required options={services} emptyLabel="انتخاب خدمت…" />
            <Field label="عنوان" name="title" required placeholder="مثلاً قرارداد واحد ۱۲" />
            <Field
              label="اولویت"
              name="priority"
              type="select"
              defaultValue="normal"
              options={[
                { value: "low", label: "کم" },
                { value: "normal", label: "عادی" },
                { value: "high", label: "زیاد" },
                { value: "urgent", label: "فوری" },
              ]}
            />
          </div>
        </ActionForm>
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
                <Field label="کلید (انگلیسی)" name="key" required placeholder="legal" />
                <Field label="نام" name="name" required placeholder="واحد حقوقی" />
                <Field label="ترتیب" name="sortOrder" type="number" defaultValue={0} />
              </div>
              <Field label="توضیحات" name="description" />
            </ActionForm>
          </div>
        </div>
      ) : null}

      <KanbanBoard board={board} staff={staffList} csrf={csrf} canManageUnits={isAdmin} />
    </>
  );
}
