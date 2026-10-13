import { requireSession, getCsrfToken } from "@/auth/session";
import { can } from "@/auth/rbac";
import * as Platform from "@/db/repos/platform";
import * as Cases from "@/db/repos/cases";
import { loadAllDefinitions, validateAllDefinitions, buildEngine } from "@/domain/workflows";
import { toJalaliDateTime } from "@/lib/jalali";
import { faNumber } from "@/lib/money";
import { ActionForm, Field } from "../forms";
import { activateWorkflowAction, importWorkflowAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const session = await requireSession();
  const csrf = await getCsrfToken();
  const isAdmin = can(session.role, "workflow.manage");

  const dbRows = Platform.listWorkflows();
  const fileReport = validateAllDefinitions();
  const allCases = Cases.listCases({ limit: 1000 });
  const countsByWorkflow = new Map<string, number>();
  for (const row of allCases) {
    const key = row.workflow_key ?? "contract";
    countsByWorkflow.set(key, (countsByWorkflow.get(key) ?? 0) + 1);
  }

  return (
    <>
      <div className="card">
        <div className="card-title-row">
          <div>
            <h2 style={{ margin: 0 }}>گردش‌کارها</h2>
            <div className="small muted">
              منبع حقیقت، فایل‌های <span className="mono">workflow-definitions/*.json</span> هستند و در دیتابیس نسخه‌بندی می‌شوند. هر پرونده به نسخه
              فعال همان کلید قفل می‌شود.
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>تعریف‌های روی دیسک</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>کلید</th>
                <th>نام</th>
                <th>نسخه</th>
                <th>حالت‌ها</th>
                <th>گذارها</th>
                <th>اعتبار</th>
                <th>پرونده‌های فعال</th>
              </tr>
            </thead>
            <tbody>
              {loadAllDefinitions().map(({ key, version, definition }) => {
                const issues = fileReport[`${key}@${version}`] ?? [];
                const errors = issues.filter((i) => i.level === "error");
                const warnings = issues.filter((i) => i.level === "warning");
                let engineOk = true;
                try {
                  buildEngine(definition);
                } catch {
                  engineOk = false;
                }
                return (
                  <tr key={`${key}@${version}`}>
                    <td className="mono">{key}</td>
                    <td>{definition.name}</td>
                    <td>{faNumber(version)}</td>
                    <td>{faNumber(definition.states.length)}</td>
                    <td>{faNumber(definition.transitions.length)}</td>
                    <td>
                      {engineOk && !errors.length ? (
                        <span className="badge success">معتبر</span>
                      ) : (
                        <span className="badge danger">{faNumber(errors.length)} خطا</span>
                      )}
                      {warnings.length ? <span className="badge warning">{faNumber(warnings.length)} هشدار</span> : null}
                      {errors.slice(0, 2).map((issue) => (
                        <div key={issue.code + issue.message} className="small" style={{ color: "var(--danger)" }}>
                          {issue.message}
                        </div>
                      ))}
                    </td>
                    <td className="small">{faNumber(countsByWorkflow.get(key) ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>نسخه‌های ثبت‌شده در دیتابیس</h3>
        {dbRows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>کلید</th>
                  <th>نام</th>
                  <th>نسخه</th>
                  <th>وضعیت</th>
                  <th>تاریخ فعال‌سازی</th>
                  <th>اقدام</th>
                </tr>
              </thead>
              <tbody>
                {dbRows.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.key}</td>
                    <td>{row.name}</td>
                    <td>{faNumber(row.version)}</td>
                    <td>
                      <span className={`badge ${row.active ? "success" : "muted"}`}>{row.active ? "فعال" : "غیرفعال"}</span>
                    </td>
                    <td className="small">{row.activated_at ? toJalaliDateTime(row.activated_at) : "—"}</td>
                    <td>
                      {isAdmin ? (
                        <ActionForm
                          action={activateWorkflowAction}
                          csrf={csrf}
                          hidden={{ workflowId: row.id, active: row.active ? "false" : "true" }}
                          submitLabel={row.active ? "غیرفعال‌سازی" : "فعال‌سازی"}
                          submitClass={row.active ? "secondary small" : "success small"}
                          compact
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            هنوز تعریفی در دیتابیس ثبت نشده است. از بخش «سینک» → «بارگذاری تعریف‌ها از فایل» یا دستور <span className="mono">npm run seed</span> استفاده
            کنید.
          </div>
        )}
      </div>

      {isAdmin ? (
        <div className="card">
          <h3>بارگذاری نسخه جدید (JSON)</h3>
          <p className="small muted">
            پیش از ثبت، تعریف با موتور اعتبارسنجی بررسی می‌شود (حالت‌های تکراری، گذارهای بی‌مرجع، حالت بن‌بست و…). نمونه ساختار را از فایل‌های موجود
            بردارید.
          </p>
          <ActionForm action={importWorkflowAction} csrf={csrf} submitLabel="اعتبارسنجی و ثبت">
            <Field
              label="متن JSON تعریف گردش‌کار"
              name="definition"
              type="textarea"
              rows={8}
              required
              placeholder='{"key":"contract","version":2,"name":"…","initial":"case_created","states":[…],"transitions":[…]}'
            />
          </ActionForm>
        </div>
      ) : null}

      <div className="card">
        <h3>راهنمای گاردها و افکت‌ها</h3>
        <div className="kv">
          <div>
            <div className="k">گذارهای خودکار</div>
            <div className="v small">
              گذارهایی با <span className="mono">kind: &quot;auto&quot;</span> و بی‌نشانه‌گذاری <span className="mono">from</span> لازم را موتور خودش اجرا
              می‌کند؛ در فهرست اقدام‌های کاربر نمایش داده نمی‌شوند.
            </div>
          </div>
          <div>
            <div className="k">سقف تلاش</div>
            <div className="v small">
              گذارهای تلاش مجدد با گارد <span className="mono">attempts_below_limit</span> محافظت می‌شوند و شمارنده روی مسیرهای شکست
              (<span className="mono">increment_attempt</span>) بالا می‌رود.
            </div>
          </div>
          <div>
            <div className="k">جلوگیری از حلقه</div>
            <div className="v small">زنجیره گذارهای خودکار حداکثر ۲۵ گام و با تشخیص حلقه اجرا می‌شود.</div>
          </div>
        </div>
      </div>
    </>
  );
}
