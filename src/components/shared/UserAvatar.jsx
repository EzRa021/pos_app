// components/shared/UserAvatar.jsx
// Reusable avatar: shows the user's photo if set, otherwise role-coloured initials.
//
// Props:
//   user      – object with { avatar?, first_name?, last_name?, username?, role_slug? }
//   size      – number (px) | "xs"(24) | "sm"(32) | "md"(40) | "lg"(56) | "xl"(80)
//   className – extra Tailwind classes on the wrapper div
//   rounded   – "xl" (default, squircle) | "full" (circle)
//   onClick   – optional click handler

import { useMemo } from "react";
import { cn }      from "@/lib/utils";
import { getRoleConfig, getInitials } from "@/features/users/roleConfig";

const PRESETS = {
  xs: { px: 24, text: "text-[9px]"  },
  sm: { px: 32, text: "text-[11px]" },
  md: { px: 40, text: "text-[13px]" },
  lg: { px: 56, text: "text-[17px]" },
  xl: { px: 80, text: "text-[24px]" },
};

export default function UserAvatar({
  user,
  size      = "md",
  className = "",
  rounded   = "xl",
  onClick,
}) {
  const preset   = typeof size === "string" ? (PRESETS[size] ?? PRESETS.md) : null;
  const px       = preset ? preset.px : size;
  const textCls  = preset ? preset.text : "text-[13px]";
  const roundCls = rounded === "full" ? "rounded-full" : "rounded-xl";

  const rc       = getRoleConfig(user?.role_slug);
  const initials = useMemo(() => getInitials(user), [user]);

  const wrapStyle = { width: px, height: px, minWidth: px, flexShrink: 0 };

  if (user?.avatar) {
    return (
      <div
        style={wrapStyle}
        className={cn("relative overflow-hidden", roundCls, className)}
        onClick={onClick}
        role={onClick ? "button" : undefined}
      >
        <img
          src={user.avatar}
          alt={[user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "User"}
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div
      style={wrapStyle}
      className={cn(
        "flex items-center justify-center font-bold select-none",
        roundCls, textCls, rc.avatar, className,
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      {initials}
    </div>
  );
}
