// ============================================================================
// components/shared/CurrencyDisplay.jsx
// ============================================================================
// Renders a monetary value with consistent typographic treatment.
// Uses tabular-nums so amounts align cleanly in table columns.
//
// Props:
//   value      number | string   — raw value (strings are parsed with parseFloat)
//   size       "xs"|"sm"|"md"|"lg"|"xl"   — typography size, default: "md"
//   color      "default"|"success"|"destructive"|"muted"  — default: "default"
//   showSign   boolean           — prefix + for positive values (default: false)
//   compact    boolean           — use compact K/M notation (default: false)
//   className  string
//
// Design: monospace-adjacent stack — currency symbol smaller than the digits,
// both in tabular-nums for column alignment.
// ============================================================================

import { cn }                              from "@/lib/utils";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";

const SIZE_CLASSES = {
  xs:  "text-[11px] leading-none",
  sm:  "text-xs leading-none",
  md:  "text-sm leading-none",
  lg:  "text-base leading-none font-semibold",
  xl:  "text-xl leading-none font-bold",
};

const COLOR_CLASSES = {
  default:     "text-foreground",
  success:     "text-success",
  destructive: "text-destructive",
  muted:       "text-muted-foreground",
  warning:     "text-warning",
};

export function CurrencyDisplay({
  value,
  size = "md",
  color = "default",
  showSign = false,
  compact = false,
  className,
}) {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  const isNegative = num < 0;

  // Build display string
  let display = compact ? formatCurrencyCompact(Math.abs(num)) : formatCurrency(Math.abs(num));

  // Determine effective color — negative values use destructive unless overridden
  const effectiveColor =
    color !== "default" ? color : isNegative ? "destructive" : "default";

  const prefix = isNegative ? "−" : showSign && num > 0 ? "+" : "";

  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        SIZE_CLASSES[size] ?? SIZE_CLASSES.md,
        COLOR_CLASSES[effectiveColor] ?? COLOR_CLASSES.default,
        className
      )}
    >
      {prefix}{display}
    </span>
  );
}
