import Link from "next/link";
import { requireSession, getCsrfToken } from "@/auth/session";
import * as Cases from "@/db/repos/cases";
import * as People from "@/db/repos/people";
import { toJalaliDateTime, relativeFa } from "@/lib/jalali";
import { faNumber } from "@/lib/money";
import { PRIORITY_LABELS, TASK_STATUS_LABELS, labelOf } from "@/lib/fa-labels";
import { ActionForm, Field } from "../forms";
import { addTaskAction, completeTaskAction } from "../cases/actions";

export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const csrf = await getCsrfToken();
  const params = await searchParams;

  const status = typeof params.status === "string" ? params.status : "open";
  const mine = params.mine === "1";
  const overdue = params.overdue === "1";
  const staff = People.listActiveStaff();

  const statuses = status === "all" ? undefined : status === "done" ? ["done"] : ["open", "in_progress"];
  const tasks = Cases.listTasks({
    assigneeId: mine ? session.staff.id : undefined,
    status: statuses,
    overdue: overdue || undefined,
    limit: 300,
  });
  const counts = Cases.countOpenTasks();
  const now = Date.now();

  return (
    <>
      <div className="grid grid-3">
        <div className="stat">
          <div className="k">وظایف باز</div>
          <div className="v">{faNumber(counts.total)}</div>
        </div>
        <div className="stat">
          <div className="k">عقب‌افتاده</div>
          <div className="v" style={{ color: counts.overdue ? "var(--danger)" : undefined }}>
            {faNumber(counts.overdue)}
          </div>
        </div>
        <div className="stat">
          <div className="k">نمایش در این فهرست</div>
          <div className="v">{faNumber(tasks.length)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2 style={{ margin: 0 }}>کارتابل وظایف</h2>
        </div>
        <form method="get" className="filters">
          <div className="field">
            <label htmlFor="f-status">وضعیت</label>
            <select id="f-status" name="status" defaultValue={status}>
              <option value="open">باز و در جریان</option>
              <option value="done">انجام‌شده</option>
              <option value="all">همه</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-mine">فقط وظایف من</label>
            <select id="f-mine" name="mine" defaultValue={mine ? "1" : ""}>
              <option value="">خیر</option>
              <option value="1">بله</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-overdue">فقط عقب‌افتاده</label>
            <select id="f-overdue" name="overdue" defaultValue={overdue ? "1" : ""}>
              <option value="">خیر</option>
              <option value="1">بله</option>
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
        <h3>ثبت وظیفه (بدون پرونده)</h3>
        <ActionForm action={addTaskAction} csrf={csrf} submitLabel="ثبت وظیفه" submitClass="secondary">
          <div className="form-row">
            <Field label="عنوان" name="title" required />
            <Field
              label="مسئول"
              name="assigneeId"
              type="select"
              defaultValue={session.staff.id}
              options={staff.map((s) => ({ value: s.id, label: s.full_name }))}
            />
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

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>وظیفه</th>
                <th>پرونده</th>
                <th>مسئول</th>
                <th>اولویت</th>
                <th>سررسید</th>
                <th>وضعیت</th>
                <th>اقدام</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length ? (
                tasks.map((task) => {
                  const row = task.case_id ? Cases.findCaseById(task.case_id) : null;
                  const assignee = task.assignee_id ? People.findStaffById(task.assignee_id) : null;
                  const isOverdue = Boolean(task.due_at && task.status !== "done" && new Date(task.due_at).getTime() < now);
                  return (
                    <tr key={task.id}>
                      <td>
                        {task.title}
                        {task.description ? <div className="small muted">{task.description}</div> : null}
                        {task.result_note ? <div className="small muted">نتیجه: {task.result_note}</div> : null}
                      </td>
                      <td className="small">
                        {row ? <Link href={`/panel/cases/${row.id}`}>{row.code ?? row.title ?? "پرونده"}</Link> : "—"}
                      </td>
                      <td className="small">{assignee?.full_name ?? "—"}</td>
                      <td>
                        <span className={`badge ${task.priority === "high" || task.priority === "urgent" ? "danger" : "muted"}`}>
                          {labelOf(PRIORITY_LABELS, task.priority)}
                        </span>
                      </td>
                      <td className="small" style={isOverdue ? { color: "var(--danger)" } : undefined}>
                        {task.due_at ? (
                          <>
                            {toJalaliDateTime(task.due_at)}
                            <div className="muted">{relativeFa(task.due_at)}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <span className={`badge ${task.status === "done" ? "success" : isOverdue ? "danger" : "info"}`}>
                          {labelOf(TASK_STATUS_LABELS, task.status)}
                        </span>
                      </td>
                      <td>
                        {task.status === "done" ? (
                          "—"
                        ) : (
                          <ActionForm
                            action={completeTaskAction}
                            csrf={csrf}
                            hidden={{ taskId: task.id, caseId: task.case_id ?? "" }}
                            submitLabel="انجام شد"
                            submitClass="success small"
                            compact
                          />
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="empty">
                    وظیفه‌ای با این فیلترها یافت نشد.
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
