import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  TrendingUp,
  FileBarChart,
  GitCompare,
  Users2,
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
// unless explicitly asked"). Segments and Cleaning & Download are
// admin/user only: a client shouldn't be exporting their own customer PII
// or triggering a data-cleaning action themselves.
export const MAIN_NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["admin", "user", "client"] },
  {
    label: "Retention",
    href: process.env.NEXT_PUBLIC_RETENTION_DASHBOARD_URL || "#",
    icon: TrendingUp,
    roles: ["admin", "user", "client"],
    external: true,
  },
  { label: "Reports", href: "/dashboard/reports", icon: FileBarChart, roles: ["admin", "user", "client"] },
  { label: "Comparisons", href: "/dashboard/comparisons", icon: GitCompare, roles: ["admin", "user", "client"] },
  { label: "Segments", href: "/dashboard/segments", icon: Users2, roles: ["admin", "user"] },
  { label: "Cleaning", href: "/dashboard/cleaning", icon: Sparkles, roles: ["admin", "user"] },
];

export const ADMIN_NAV: NavItem[] = [
  { label: "Clients", href: "/dashboard/admin/clients", icon: Building2, roles: ["admin"] },
  { label: "Users", href: "/dashboard/admin/users", icon: UserCog, roles: ["admin"] },
  { label: "Permissions", href: "/dashboard/admin/permissions", icon: ShieldCheck, roles: ["admin"] },
  { label: "Data Sources", href: "/dashboard/admin/data-sources", icon: Database, roles: ["admin"] },
  { label: "System Settings", href: "/dashboard/admin/settings", icon: SlidersHorizontal, roles: ["admin"] },
];
