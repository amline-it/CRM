import { requireSession, getCsrfToken } from "@/auth/session";
import { can } from "@/auth/rbac";
import * as People from "@/db/repos/people";
import * as Cases from "@/db/repos/cases";
import { toJalaliDateTime, relativeFa } from "@/lib/jalali";
import { faNumber } from "@/lib/money";
import { STAFF_ROLE_LABELS, labelOf } from "@/lib/fa-labels";
import { ActionForm, Field } from "../forms";
import { createStaffAction, resetStaffPasswordAction, revokeStaffSessionsAction, updateStaffAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const session = await requireSession();
  const csrf = await getCsrfToken();
  const staff = People.listStaff();
  const isAdmin = can(session.role, "staff.manage");
  const openTasks = Cases.listTasks({ status: ["open", "in_progress"], limit: 500 });

  const load = new Map<string, number>();
  for (const task of openTasks) {
    if (!task.assignee_id) continue;
    load.set(task.assignee_id, (load.get(task.assignee_id) ?? 0) + 1);
  }

  return (
    <>
      <div className="grid grid-4">
        <div className="stat">
          <div className="k">کارشناسان</div>
          <div className="v">{faNumber(staff.length)}</div>
        </div>
        <div className="stat">
          <div className="k">فعال</div>
          <div className="v">{faNumber(staff.filter((s) => s.active).length)}</div>
        </div>
        <div className="stat">
          <div className="k">مدیران</div>
          <div className="v">{faNumber(staff.filter((s) => s.role === "admin").length)}</div>
        </div>
        <div className="stat">
          <div className="k">وظایف باز تیم</div>
          <div className="v">{faNumber(openTasks.length)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <div>
            <h2 style={{ margin: 0 }}>کارشناسان و مدیران</h2>
            <div className="small muted">ورود به پنل CRM فقط برای همین افراد فعال است (مدیر و کارمند).</div>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>نام</th>
                <th>نام کاربری</th>
                <th>نقش</th>
                <th>وضعیت</th>
                <th>بار کاری</th>
                <th>آخرین ورود</th>
                <th>ورود سازمانی</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr key={member.id}>
                  <td>{member.full_name}</td>
                  <td className="mono small">{member.username}</td>
                  <td>
                    <span className={`badge ${member.role === "admin" ? "info" : "muted"}`}>{labelOf(STAFF_ROLE_LABELS, member.role)}</span>
                  </td>
                  <td>
                    <span className={`badge ${member.active ? "success" : "danger"}`}>{member.active ? "فعال" : "غیرفعال"}</span>
                  </td>
                  <td className="small">{faNumber(load.get(member.id) ?? 0)} وظیفه باز</td>
                  <td className="small">{member.last_login_at ? relativeFa(member.last_login_at) : "—"}</td>
                  <td className="small mono">{member.sso_subject ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isAdmin ? (
        <>
          {staff.map((member) => (
            <div className="card" key={`edit-${member.id}`}>
              <h3 style={{ fontSize: 14 }}>
                مدیریت {member.full_name}
                <span className="small muted"> — ایجاد: {toJalaliDateTime(member.created_at)}</span>
              </h3>
              <div className="grid grid-2">
                <ActionForm action={updateStaffAction} csrf={csrf} hidden={{ staffId: member.id }} submitLabel="ذخیره" submitClass="secondary small">
                  <div className="form-row">
                    <Field label="نام کامل" name="fullName" defaultValue={member.full_name} />
                    <Field
                      label="نقش"
                      name="role"
                      type="select"
                      defaultValue={member.role}
                      options={[
                        { value: "staff", label: "کارمند" },
                        { value: "admin", label: "مدیر" },
                      ]}
                    />
                    <Field
                      label="وضعیت"
                      name="active"
                      type="select"
                      defaultValue={member.active ? "true" : "false"}
                      options={[
                        { value: "true", label: "فعال" },
                        { value: "false", label: "غیرفعال" },
                      ]}
                    />
                  </div>
                </ActionForm>

                <div>
                  <ActionForm action={resetStaffPasswordAction} csrf={csrf} hidden={{ staffId: member.id }} submitLabel="تغییر رمز" submitClass="secondary small">
                    <Field label="رمز عبور جدید" name="password" type="password" required hint="حداقل ۶ کاراکتر" />
                  </ActionForm>
                  <ActionForm
                    action={revokeStaffSessionsAction}
                    csrf={csrf}
                    hidden={{ staffId: member.id }}
                    submitLabel="بستن همه نشست‌ها"
                    submitClass="danger small"
                    compact
                  />
                </div>
              </div>
            </div>
          ))}

          <div className="card">
            <h3>افزودن کارشناس</h3>
            <ActionForm action={createStaffAction} csrf={csrf} submitLabel="ایجاد حساب">
              <div className="form-row">
                <Field label="نام کاربری" name="username" required placeholder="expert1" />
                <Field label="نام کامل" name="fullName" required />
                <Field
                  label="نقش"
                  name="role"
                  type="select"
                  defaultValue="staff"
                  options={[
                    { value: "staff", label: "کارمند" },
                    { value: "admin", label: "مدیر" },
                  ]}
                />
                <Field label="رمز عبور" name="password" type="password" required hint="حداقل ۶ کاراکتر" />
              </div>
            </ActionForm>
          </div>
        </>
      ) : (
        <div className="alert info">مدیریت حساب‌ها فقط در دسترس مدیر است.</div>
      )}
    </>
  );
}
