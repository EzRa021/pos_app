// components/shared/DateRangePicker.jsx — From / To date range filter (calendar popover)
import { X }           from "lucide-react"
import { DatePicker }  from "@/components/shared/DatePicker"
import { cn }          from "@/lib/utils"

/**
 * DateRangePicker — two DatePicker calendar buttons side-by-side.
 *
 * Props:
 *   from         string | "" — YYYY-MM-DD
 *   to           string | "" — YYYY-MM-DD
 *   onFromChange (val: string) => void
 *   onToChange   (val: string) => void
 *   onClear      () => void  — clears both (shown only when either is set)
 *   className    string
 */
export function DateRangePicker({ from, to, onFromChange, onToChange, onClear, className }) {
  const hasValue = from || to
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <DatePicker
        value={from}
        onChange={onFromChange}
        placeholder="From date"
        clearable={false}
      />
      <span className="text-[11px] text-muted-foreground select-none">–</span>
      <DatePicker
        value={to}
        onChange={onToChange}
        placeholder="To date"
        clearable={false}
      />
      {hasValue && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3 w-3" />Clear
        </button>
      )}
    </div>
  )
}
