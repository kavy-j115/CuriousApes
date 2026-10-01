import type { LucideIcon } from "lucide-react";
import { Store, Users, Settings } from "lucide-react";
import type { Role } from "@/lib/auth/profile";

export const ROLE_THEME: Record<
  Role,
  {
    label: string;
    tagline: string;
    icon: LucideIcon;
    iconBg: string;
    button: string;
    accentText: string;
    badge: string;
  }
> = {
  client: {
    label: "Client",
    tagline: "Access your brand's analytics and insights.",
    icon: Store,
    iconBg: "bg-lime-400 text-black",
    button: "bg-lime-400 text-black hover:bg-lime-300",
    accentText: "text-lime-400",
    badge: "bg-lime-400/15 text-lime-400",
  },
  user: {
    label: "User",
    tagline: "Manage assigned clients, data and reports.",
    icon: Users,
    iconBg: "bg-sky-500 text-white",
    button: "bg-sky-500 text-white hover:bg-sky-400",
    accentText: "text-sky-400",
    badge: "bg-sky-400/15 text-sky-400",
  },
  admin: {
    label: "Admin",
    tagline: "Manage clients, users, data and platform operations.",
    icon: Settings,
    iconBg: "bg-orange-500 text-white",
    button: "bg-orange-500 text-white hover:bg-orange-400",
    accentText: "text-orange-400",
    badge: "bg-orange-400/15 text-orange-400",
  },
};

export const ROLE_LABEL_WITH_ARTICLE: Record<Role, string> = {
  client: "a client",
  user: "a user",
  admin: "an admin",
};
