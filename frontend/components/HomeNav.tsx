"use client";

import Link from "next/link";
import { useUserRole } from "@/lib/useUserRole";

const NAV_LINKS = [
  { href: "/company", label: "Companies" },
  { href: "/employee", label: "Employees" },
];

export function HomeNav() {
  const { isCompany, primaryWallet } = useUserRole();

  const links =
    !primaryWallet || isCompany === null
      ? NAV_LINKS
      : isCompany
        ? [{ href: "/company", label: "Companies" }]
        : [{ href: "/employee", label: "Employees" }];

  const showDashboardButton = primaryWallet && isCompany !== null;
  const dashboardHref = isCompany ? "/company" : "/employee";
  const dashboardLabel = isCompany ? "Go to dashboard →" : "View my earnings →";

  return (
    <nav className="sticky top-0 z-50 border-b border-line px-8 bg-bg/92 backdrop-blur-md">
      <div className="max-w-7xl mx-auto h-14 flex items-center justify-between">
        <span className="font-heading text-lg font-bold tracking-widest uppercase text-gold">
          PayFlow
        </span>
        <div className="flex items-center gap-8">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="section-label transition-colors hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
          {showDashboardButton && (
            <Link
              href={dashboardHref}
              className="px-4 py-1.5 font-mono text-xs tracking-widest font-medium border border-gold-dim text-gold bg-gold/15 transition-all hover:brightness-110"
            >
              {dashboardLabel}
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
