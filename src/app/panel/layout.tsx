import Link from "next/link";
import { requireSession } from "@/auth/session";
import { can } from "@/auth/rbac";
import { ensureMigrated } from "@/db/migrate";
import * as Cases from "@/db/repos/cases";
import * as Catalog from "@/db/repos/catalog";
import { STAFF_ROLE_LABELS } from "@/lib/fa-labels";
import { faNumber } from "@/lib/money";
import { LogoutButton } from "@/components/session-bridge";
import { demoModeEnabled } from "@/auth/demo";
import { SideNav, type NavGroup } from "./nav";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  ensureMigrated();
  const session = await requireSession();
  const { role } = session;
  // فقط در پیش‌نمایش محلی فعال می‌شود (روی سرور واقعی خاموش است)
  const demo = demoModeEnabled();

  const openCases = Cases.countOpenCases();
  const openTasks = Cases.countOpenTasks();
  const listingsInReview = Catalog.listListings({ status: "pending_review", limit: 100 }).length;
  const requirementsOpen = Catalog.listRequirements({ status: "open", limit: 100 }).length;

  const groups: NavGroup[] = [
    {
      title: "کارتابل",
      items: [
        { href: "/panel", label: "داشبورد" },
        { href: "/panel/tasks", label: "وظایف من", badge: openTasks.total },
      ],
    },
    {
      title: "پرونده‌ها",
      items: [
        { href: "/panel/cases", label: "همه پرونده‌ها", badge: openCases },
        { href: "/panel/cases?service=contract", label: "قراردادها" },
        { href: "/panel/listings", label: "آگهی‌ها", badge: listingsInReview },
        { href: "/panel/requirements", label: "نیازمندی‌ها", badge: requirementsOpen },
        { href: "/panel/users", label: "کاربران سینک‌شده" },
      ],
    },
    {
      title: "مدیریت",
      items: [
        { href: "/panel/services", label: "خدمات و قیمت‌ها", adminOnly: true },
        { href: "/panel/workflows", label: "گردش‌کارها", adminOnly: true },
        { href: "/panel/staff", label: "کارمندان", adminOnly: true },
        { href: "/panel/sync", label: "وضعیت سینک", adminOnly: true },
        { href: "/panel/audit", label: "لاگ حسابرسی", adminOnly: true },
      ],
    },
  ];

  const visibleGroups = groups.map((g) => ({
    ...g,
    items: g.items.filter((item) => !item.adminOnly || can(role, "settings.manage") || role === "admin"),
  }));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>🏢</span>
          <span>CRM املاک</span>
        </div>
        <SideNav groups={visibleGroups} />
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="title">پنل کارشناسان و مدیران</div>
          <div className="user">
            <span className="badge muted">{faNumber(openCases)} پرونده باز</span>
            <span>
              {session.staff.full_name} · {STAFF_ROLE_LABELS[session.staff.role] ?? session.staff.role}
            </span>
            {demo ? (
              <span
                className="badge"
                title="این حالت فقط روی پیش‌نمایش محلی فعال است و روی سرور واقعی وجود ندارد"
                style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d" }}
              >
                حالت نمایش محلی · ورود غیرفعال
              </span>
            ) : (
              <LogoutButton />
            )}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
