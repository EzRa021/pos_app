// features/users/roleConfig.js — role colours & icons shared across user UI
// Matches the 5 seeded roles in migration 0001_roles_permissions.sql
export const ROLE_CONFIG = {
  super_admin: {
    label:   "Super Admin",
    dot:     "bg-rose-500",
    badge:   "bg-rose-500/15 text-rose-400 border-rose-500/25",
    ring:    "ring-rose-500/30",
    avatar:  "bg-rose-500/20 text-rose-400",
  },
  admin: {
    label:   "Admin",
    dot:     "bg-violet-500",
    badge:   "bg-violet-500/15 text-violet-400 border-violet-500/25",
    ring:    "ring-violet-500/30",
    avatar:  "bg-violet-500/20 text-violet-400",
  },
  manager: {
    label:   "Manager",
    dot:     "bg-blue-500",
    badge:   "bg-blue-500/15 text-blue-400 border-blue-500/25",
    ring:    "ring-blue-500/30",
    avatar:  "bg-blue-500/20 text-blue-400",
  },
  cashier: {
    label:   "Cashier",
    dot:     "bg-emerald-500",
    badge:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    ring:    "ring-emerald-500/30",
    avatar:  "bg-emerald-500/20 text-emerald-400",
  },
  stock_keeper: {
    label:   "Stock Keeper",
    dot:     "bg-amber-500",
    badge:   "bg-amber-500/15 text-amber-400 border-amber-500/25",
    ring:    "ring-amber-500/30",
    avatar:  "bg-amber-500/20 text-amber-400",
  },
};

export function getRoleConfig(slug) {
  return ROLE_CONFIG[slug] ?? {
    label:  slug ?? "Unknown",
    dot:    "bg-muted-foreground",
    badge:  "bg-muted text-muted-foreground border-border",
    ring:   "ring-border",
    avatar: "bg-muted text-muted-foreground",
  };
}

/** Derive initials from a user object */
export function getInitials(user) {
  if (!user) return "?";
  const f = user.first_name?.charAt(0) ?? "";
  const l = user.last_name?.charAt(0)  ?? "";
  return (f + l).toUpperCase() || user.username?.charAt(0).toUpperCase() || "?";
}
