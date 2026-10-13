import { requireSession, getCsrfToken } from "@/auth/session";
import { can } from "@/auth/rbac";
import * as Catalog from "@/db/repos/catalog";
import { loadDefinition } from "@/domain/workflows";
import { faMoney, faNumber } from "@/lib/money";
import { SERVICE_CATEGORY_LABELS, labelOf } from "@/lib/fa-labels";
import { ActionForm, Field } from "../forms";
import { saveServiceAction, toggleServiceAction } from "./actions";

export const dynamic = "force-dynamic";

const CATEGORY_OPTIONS = Object.entries(SERVICE_CATEGORY_LABELS).map(([value, label]) => ({ value, label }));
const WORKFLOW_OPTIONS = [
  { value: "contract", label: "گردش‌کار قرارداد" },
  { value: "listing", label: "گردش‌کار آگهی" },
  { value: "requirements", label: "گردش‌کار نیازمندی" },
  { value: "custom_service", label: "گردش‌کار خدمت سفارشی" },
];

const STATE_COUNT: Record<string, number> = {
  contract: loadDefinition("contract", 1).states.length,
  listing: loadDefinition("listing", 1).states.length,
  requirements: loadDefinition("requirements", 1).states.length,
  custom_service: loadDefinition("custom_service", 1).states.length,
};

export default async function ServicesPage() {
  const session = await requireSession();
  const csrf = await getCsrfToken();
  const services = Catalog.listServices(false);
  const isAdmin = can(session.role, "service.manage");

  return (
    <>
      <div className="card">
        <div className="card-title-row">
          <div>
            <h2 style={{ margin: 0 }}>خدمات</h2>
            <div className="small muted">
              هر خدمت به یک گردش‌کار متصل است؛ خدمات فعال در صفحه «پرونده‌ها» برای تشکیل پرونده نمایش داده می‌شوند.
            </div>
          </div>
          <span className="small muted">{faNumber(services.length)} خدمت</span>
        </div>
      </div>

      {services.map((service) => (
        <div className="card" key={service.id}>
          <div className="card-title-row">
            <div>
              <h3 style={{ margin: 0 }}>
                {service.name}
                <span className={`badge ${service.active ? "success" : "muted"}`}>{service.active ? "فعال" : "غیرفعال"}</span>
                <span className="badge info">{labelOf(SERVICE_CATEGORY_LABELS, service.category)}</span>
              </h3>
              <div className="small muted mono">کلید: {service.key}</div>
            </div>
            <div className="small">
              قیمت: {faMoney(service.price)}
              <div className="muted">
                {service.requires_subscription ? "نیازمند اشتراک · " : ""}
                {service.requires_referral ? "نیازمند معرفی‌نامه · " : ""}
                گردش‌کار: {service.workflow_key} ({faNumber(STATE_COUNT[service.workflow_key] ?? 0)} حالت)
              </div>
            </div>
          </div>

          {service.description ? <p className="small muted">{service.description}</p> : null}
          <div className="small">
            مدارک لازم: <span className="mono">{(JSON.parse(service.required_documents || "[]") as string[]).join("، ") || "—"}</span>
          </div>

          {isAdmin ? (
            <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <ActionForm
                action={saveServiceAction}
                csrf={csrf}
                hidden={{ key: service.key }}
                submitLabel="ذخیره تغییرات"
                submitClass="secondary small"
              >
                <div className="form-row">
                  <Field label="نام خدمت" name="name" defaultValue={service.name} required />
                  <Field label="دسته" name="category" type="select" defaultValue={service.category} options={CATEGORY_OPTIONS} />
                  <Field label="گردش‌کار" name="workflowKey" type="select" defaultValue={service.workflow_key} options={WORKFLOW_OPTIONS} />
                  <Field label="قیمت (تومان)" name="price" type="number" defaultValue={service.price} />
                  <Field
                    label="نیازمند اشتراک"
                    name="requiresSubscription"
                    type="select"
                    defaultValue={service.requires_subscription ? "true" : "false"}
                    options={[
                      { value: "false", label: "خیر" },
                      { value: "true", label: "بله" },
                    ]}
                  />
                  <Field
                    label="نیازمند معرفی‌نامه"
                    name="requiresReferral"
                    type="select"
                    defaultValue={service.requires_referral ? "true" : "false"}
                    options={[
                      { value: "false", label: "خیر" },
                      { value: "true", label: "بله" },
                    ]}
                  />
                  <Field
                    label="وضعیت"
                    name="active"
                    type="select"
                    defaultValue={service.active ? "true" : "false"}
                    options={[
                      { value: "true", label: "فعال" },
                      { value: "false", label: "غیرفعال" },
                    ]}
                  />
                  <Field label="ترتیب نمایش" name="sortOrder" type="number" defaultValue={service.sort_order} />
                </div>
                <Field label="توضیح" name="description" defaultValue={service.description} />
                <Field
                  label="مدارک لازم (هر خط یک عنوان)"
                  name="requiredDocuments"
                  type="textarea"
                  rows={2}
                  defaultValue={(JSON.parse(service.required_documents || "[]") as string[]).join("\n")}
                />
              </ActionForm>
              <ActionForm
                action={toggleServiceAction}
                csrf={csrf}
                hidden={{ key: service.key }}
                submitLabel={service.active ? "غیرفعال‌سازی خدمت" : "فعال‌سازی خدمت"}
                submitClass={service.active ? "danger small" : "success small"}
                compact
              />
            </div>
          ) : null}
        </div>
      ))}

      {isAdmin ? (
        <div className="card">
          <h3>افزودن خدمت جدید</h3>
          <ActionForm action={saveServiceAction} csrf={csrf} submitLabel="ایجاد خدمت">
            <div className="form-row">
              <Field label="کلید (انگلیسی، یکتا)" name="key" required placeholder="contract_rent" />
              <Field label="نام خدمت" name="name" required placeholder="تنظیم قرارداد اجاره" />
              <Field label="دسته" name="category" type="select" defaultValue="contract" options={CATEGORY_OPTIONS} />
              <Field label="گردش‌کار" name="workflowKey" type="select" defaultValue="contract" options={WORKFLOW_OPTIONS} />
              <Field label="قیمت (تومان)" name="price" type="number" defaultValue={0} />
              <Field
                label="نیازمند اشتراک"
                name="requiresSubscription"
                type="select"
                defaultValue="false"
                options={[
                  { value: "false", label: "خیر" },
                  { value: "true", label: "بله" },
                ]}
              />
              <Field
                label="نیازمند معرفی‌نامه"
                name="requiresReferral"
                type="select"
                defaultValue="false"
                options={[
                  { value: "false", label: "خیر" },
                  { value: "true", label: "بله" },
                ]}
              />
              <Field label="ترتیب نمایش" name="sortOrder" type="number" defaultValue={0} />
            </div>
            <Field label="توضیح" name="description" type="textarea" rows={2} />
            <Field label="مدارک لازم (هر خط یک عنوان)" name="requiredDocuments" type="textarea" rows={3} placeholder={"کارت ملی\nسند مالکیت"} />
          </ActionForm>
        </div>
      ) : (
        <div className="alert info">فقط مدیر می‌تواند خدمات را تغییر دهد؛ این فهرست فقط‌خواندنی است.</div>
      )}
    </>
  );
}
