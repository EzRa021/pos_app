// components/shared/DateRangePicker.jsx — Compact From/To range picker with dual-month calendar
import { useState }                         from "react"
import { format, parseISO, isValid }        from "date-fns"
import { Calendar as CalendarIcon, X }      from "lucide-react"
import { Calendar }                         from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button }                           from "@/components/ui/button"
import { cn }                               from "@/lib/utils"

/**
 * DateRangePicker — single compact trigger + dual-month range calendar.
 *
 * Props:
 *   from         string | "" — YYYY-MM-DD
 *   to           string | "" — YYYY-MM-DD
 *   onFromChange (val: string) => void
 *   onToChange   (val: string) => void
 *   onClear      () => void  — clears both
 *   className    string
 */
export function DateRangePicker({ from, to, onFromChange, onToChange, onClear, className }) {
  const [open, setOpen] = useState(false)

  const fromDate  = from ? parseISO(from) : undefined
  const toDate    = to   ? parseISO(to)   : undefined
  const fromValid = from && isValid(fromDate)
  const toValid   = to   && isValid(toDate)
  const hasValue  = fromValid || toValid

  const range = {
    from: fromValid ? fromDate : undefined,
    to:   toValid   ? toDate   : undefined,
  }

  function handleSelect(selected) {
    if (!selected) {
      onFromChange("")
      onToChange("")
      return
    }
    onFromChange(selected.from ? format(selected.from, "yyyy-MM-dd") : "")
    onToChange(selected.to   ? format(selected.to,   "yyyy-MM-dd") : "")
    // Close once both ends are chosen
    if (selected.from && selected.to) setOpen(false)
  }

  function handleClear(e) {
    e.stopPropagation()
    onFromChange("")
    onToChange("")
    onClear?.()
  }

  // ── Trigger label ──────────────────────────────────────────────────────────
  let fromLabel, toLabel
  if (fromValid) {
    const now = new Date()
    // Show year only if different from current year
    fromLabel = fromDate.getFullYear() !== now.getFullYear()
      ? format(fromDate, "MMM d, yy")
      : format(fromDate, "MMM d")
  }
  if (toValid) {
    const now = new Date()
    toLabel = toDate.getFullYear() !== now.getFullYear()
      ? format(toDate, "MMM d, yy")
      : format(toDate, "MMM d")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-8 w-full justify-start gap-2 px-2.5 text-left font-normal text-[11px] min-w-0",
            !hasValue && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

          {hasValue ? (
            <span className="flex items-center gap-1 flex-1 min-w-0 truncate">
              <span className={cn(fromValid ? "text-foreground" : "text-muted-foreground")}>
                {fromValid ? fromLabel : "From"}
              </span>
              <span className="text-muted-foreground">–</span>
              <span className={cn(toValid ? "text-foreground" : "text-muted-foreground")}>
                {toValid ? toLabel : "To"}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1 flex-1 min-w-0">
              <span>From</span>
              <span className="text-muted-foreground/60">–</span>
              <span>To date</span>
            </span>
          )}

          {hasValue && (
            <span
              role="button"
              tabIndex={0}
              className="ml-auto shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              onClick={handleClear}
              onKeyDown={(e) => e.key === "Enter" && handleClear(e)}
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-auto p-0 border-border bg-card shadow-xl"
        align="start"
        side="right"
        sideOffset={8}
      >
        <div className="p-3 border-b border-border">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Select date range
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[11px] text-foreground">
              {fromValid ? format(fromDate, "MMM d, yyyy") : <span className="text-muted-foreground">From date</span>}
            </span>
            <span className="text-muted-foreground">→</span>
            <span className="text-[11px] text-foreground">
              {toValid ? format(toDate, "MMM d, yyyy") : <span className="text-muted-foreground">To date</span>}
            </span>
            {hasValue && (
              <button
                type="button"
                onClick={handleClear}
                className="ml-auto text-[10px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-0.5"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
        </div>
        <Calendar
          mode="range"
          selected={range}
          onSelect={handleSelect}
          numberOfMonths={2}
          initialFocus
          className="text-foreground"
        />
      </PopoverContent>
    </Popover>
  )
}
