import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  TrendingUp,
  FileBarChart,
  GitCompare,
  Users2,
  Bell,
  Sparkles,
  Building2,
  UserCog,
  ShieldCheck,
  Database,
  SlidersHorizontal,
} from "lucide-react";
import type { Role } from "@/lib/auth/profile";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  external?: boolean;
};

// Retention deliberately links OUT to the existing retention dashboard
// rather than getting its own page here -- see docs/architecture.md
// ("dashboard-agnostic... we will not modify the retention dashboard
// unless explicitly asked"). Admin/user only, same reasoning as Segments:
// an agency-internal tool, not something a client account should see.
//
// Cleaning is deliberately NOT listed here -- the feature turned out more
// complicated than it was worth for now, so it's hidden from the nav
// while the code stays in place (src/app/dashboard/cleaning/) for later.
export const MAIN_NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["admin", "user", "client"] },
  {
    label: "Retention",
    href: process.env.NEXT_PUBLIC_RETENTION_DASHBOARD_URL || "#",
    icon: TrendingUp,
    roles: ["admin", "user"],
    external: true,
  },
  { label: "Reports", href: "/dashboard/reports", icon: FileBarChart, roles: ["admin", "user", "client"] },
  { label: "Comparisons", href: "/dashboard/comparisons", icon: GitCompare, roles: ["admin", "user", "client"] },
  { label: "Alerts", href: "/dashboard/alerts", icon: Bell, roles: ["admin", "user", "client"] },
  { label: "AI Report", href: "/dashboard/ai-report", icon: Sparkles, roles: ["admin", "user", "client"] },
  { label: "Segments", href: "/dashboard/segments", icon: Users2, roles: ["admin", "user"] },
];

export const ADMIN_NAV: NavItem[] = [
  { label: "Clients", href: "/dashboard/admin/clients", icon: Building2, roles: ["admin"] },
  { label: "Users", href: "/dashboard/admin/users", icon: UserCog, roles: ["admin"] },
  { label: "Permissions", href: "/dashboard/admin/permissions", icon: ShieldCheck, roles: ["admin"] },
  { label: "Data Sources", href: "/dashboard/admin/data-sources", icon: Database, roles: ["admin"] },
  { label: "System Settings", href: "/dashboard/admin/settings", icon: SlidersHorizontal, roles: ["admin"] },
];
