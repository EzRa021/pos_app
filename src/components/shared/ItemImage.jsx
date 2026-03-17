// ============================================================================
// components/shared/ItemImage.jsx
// ============================================================================
// Reusable item image component. Shows the base64 image when available,
// falls back to a coloured initials avatar when not.
//
// Props:
//   item        — object with { item_name, image_data }
//   size        — "xs" | "sm" | "md" | "lg" | "xl"  (default "md")
//   className   — extra tailwind classes
//   rounded     — "md" | "lg" | "xl" | "full"  (default "lg")
// ============================================================================

import { cn } from "@/lib/utils";

// Sizes map → pixel class for the container
const SIZES = {
  xs:  "h-6  w-6  text-[9px]",
  sm:  "h-8  w-8  text-[10px]",
  md:  "h-10 w-10 text-[11px]",
  lg:  "h-14 w-14 text-sm",
  xl:  "h-20 w-20 text-base",
};

const ROUNDINGS = {
  md:   "rounded-md",
  lg:   "rounded-lg",
  xl:   "rounded-xl",
  full: "rounded-full",
};

export function ItemImage({ item, size = "md", className, rounded = "lg" }) {
  const initials = (item?.item_name ?? "?").slice(0, 2).toUpperCase();
  const sizeClass   = SIZES[size]    ?? SIZES.md;
  const roundClass  = ROUNDINGS[rounded] ?? ROUNDINGS.lg;

  if (item?.image_data) {
    return (
      <img
        src={item.image_data}
        alt={item.item_name ?? "Item"}
        className={cn(
          "shrink-0 object-cover border border-border/40",
          sizeClass, roundClass, className,
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "shrink-0 flex items-center justify-center border font-bold uppercase",
        "border-primary/30 bg-primary/10 text-primary",
        sizeClass, roundClass, className,
      )}
    >
      {initials}
    </div>
  );
}
