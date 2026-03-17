// components/shared/DatePicker.jsx — Single-date picker (Popover + Calendar)
import { format, parseISO, isValid } from "date-fns"
import { Calendar as CalendarIcon, X } from "lucide-react"

import { Calendar }  from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button }    from "@/components/ui/button"
import { cn }        from "@/lib/utils"

/**
 * DatePicker — renders a trigger button that opens a calendar popover.
 *
 * Props:
 *   value       string | "" — YYYY-MM-DD
 *   onChange    (value: string) => void  — called with "YYYY-MM-DD" or ""
 *   placeholder string
 *   className   string
 *   clearable   bool — show × when a date is selected
 */
export function DatePicker({ value, onChange, placeholder = "Pick date", className, clearable = true }) {
  const date = value ? parseISO(value) : undefined
  const isSet = value && isValid(date)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-7 w-36 justify-start gap-1.5 px-2 text-left font-normal text-[11px]",
            !isSet && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">
            {isSet ? format(date, "MMM d, yyyy") : placeholder}
          </span>
          {isSet && clearable && (
            <span
              role="button"
              tabIndex={0}
              className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onChange("") }}
              onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), onChange(""))}
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 border-border bg-card" align="start">
        <Calendar
          mode="single"
          selected={isSet ? date : undefined}
          onSelect={(d) => onChange(d ? format(d, "yyyy-MM-dd") : "")}
          initialFocus
          className="text-foreground"
        />
      </PopoverContent>
    </Popover>
  )
}
