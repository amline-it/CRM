"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  badge?: number | null;
  adminOnly?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export function SideNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <>
      {groups.map((group) => (
        <div key={group.title}>
          <div className="section-title">{group.title}</div>
          <nav>
            {group.items.map((item) => {
              const active = pathname === item.href || (item.href !== "/panel" && pathname.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href} className={active ? "active" : ""}>
                  <span>{item.label}</span>
                  {item.badge ? <span className="badge warning">{new Intl.NumberFormat("fa-IR").format(item.badge)}</span> : null}
                </Link>
              );
            })}
          </nav>
        </div>
      ))}
    </>
  );
}
