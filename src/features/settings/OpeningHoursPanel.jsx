// ============================================================================
// features/settings/OpeningHoursPanel.jsx
// Mon–Sun weekly grid — open/closed toggle + time range per day
// ============================================================================
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Clock, Loader2, AlertCircle, Settings2, CheckCircle2, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn }     from "@/lib/utils";
import { toastSuccess, onMutationError } from "@/lib/toast";
import { getStoreHours, upsertStoreHours } from "@/commands/store_hours";
import { useBranchStore } from "@/stores/branch.store";

// ── constants ─────────────────────────────────────────────────────────────────

const DAYS = [
  { dow: 1, short: "Mon", full: "Monday"    },
  { dow: 2, short: "Tue", full: "Tuesday"   },
  { dow: 3, short: "Wed", full: "Wednesday" },
  { dow: 4, short: "Thu", full: "Thursday"  },
  { dow: 5, short: "Fri", full: "Friday"    },
  { dow: 6, short: "Sat", full: "Saturday"  },
  { dow: 0, short: "Sun", full: "Sunday"    },
];

// Time options in 30-min increments
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h  = Math.floor(i / 2).toString().padStart(2, "0");
  const m  = i % 2 === 0 ? "00" : "30";
  const hh = parseInt(h, 10);
  const ampm = hh < 12 ? "AM" : "PM";
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  return { value: `${h}:${m}`, label: `${h12}:${m} ${ampm}` };
});

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors",
        checked ? "border-primary bg-primary" : "border-border bg-muted",
      )}
    >
      <span className={cn(
        "block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
        checked ? "translate-x-3.5" : "translate-x-0.5",
      )} />
    </button>
  );
}

// ── TimeSelect ────────────────────────────────────────────────────────────────

function TimeSelect({ value, onChange, disabled }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      className={cn(
        "h-8 rounded-md border border-input bg-transparent px-2 text-[12px] text-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:opacity-40 disabled:cursor-not-allowed",
      )}
    >
      <option value="">—</option>
      {TIMES.map((t) => (
        <option key={t.value} value={t.value}>{t.label}</option>
      ))}
    </select>
  );
}

// ── DayRow ────────────────────────────────────────────────────────────────────

function DayRow({ day, hour, onChange }) {
  const isOpen     = hour?.is_open  ?? false;
  const openTime   = hour?.open_time  ?? "08:00";
  const closeTime  = hour?.close_time ?? "18:00";

  const update = (patch) => onChange(day.dow, { ...hour, is_open: isOpen, open_time: openTime, close_time: closeTime, ...patch });

  return (
    <div className={cn(
      "flex items-center gap-4 rounded-lg border px-4 py-3 transition-colors",
      isOpen ? "border-border bg-card" : "border-border/40 bg-muted/10",
    )}>
      {/* Day label */}
      <div className="w-10 shrink-0">
        <p className={cn("text-[13px] font-bold", isOpen ? "text-foreground" : "text-muted-foreground/50")}>
          {day.short}
        </p>
      </div>

      {/* Toggle */}
      <Toggle checked={isOpen} onChange={(v) => update({ is_open: v })} />

      {/* Status / time range */}
      {isOpen ? (
        <div className="flex items-center gap-2 flex-1">
          <TimeSelect
            value={openTime}
            onChange={(v) => update({ open_time: v })}
          />
          <span className="text-[11px] text-muted-foreground">to</span>
          <TimeSelect
            value={closeTime}
            onChange={(v) => update({ close_time: v })}
          />
        </div>
      ) : (
        <span className="text-[11px] text-muted-foreground/50 italic flex-1">Closed</span>
      )}

      {/* Duration badge */}
      {isOpen && openTime && closeTime && (
        (() => {
          const [oh, om] = openTime.split(":").map(Number);
          const [ch, cm] = closeTime.split(":").map(Number);
          const mins = (ch * 60 + cm) - (oh * 60 + om);
          if (mins <= 0) return null;
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          return (
            <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
              {h}h{m > 0 ? ` ${m}m` : ""}
            </span>
          );
        })()
      )}
    </div>
  );
}

// ── OpeningHoursPanel ─────────────────────────────────────────────────────────

export function OpeningHoursPanel() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();
  const [hours, setHours] = useState(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["store-hours", storeId],
    queryFn:  () => getStoreHours(storeId),
    enabled:  !!storeId,
  });

  useEffect(() => {
    if (data && !hours) {
      // Index by day_of_week for easy lookup
      const map = {};
      data.forEach((h) => { map[h.day_of_week] = h; });
      setHours(map);
    }
  }, [data]); // eslint-disable-line

  const handleChange = (dow, updated) => {
    setHours((prev) => ({ ...prev, [dow]: { ...prev[dow], ...updated } }));
    setSaved(false);
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = DAYS.map((d) => {
        const h = hours?.[d.dow];
        return {
          store_id:    storeId,
          day_of_week: d.dow,
          is_open:     h?.is_open   ?? false,
          open_time:   h?.is_open   ? (h.open_time  ?? "08:00") : null,
          close_time:  h?.is_open   ? (h.close_time ?? "18:00") : null,
        };
      });
      return upsertStoreHours(storeId, payload);
    },
    onSuccess: (updated) => {
      const map = {};
      updated.forEach((h) => { map[h.day_of_week] = h; });
      setHours(map);
      qc.setQueryData(["store-hours", storeId], updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toastSuccess("Opening Hours Saved", "Hours updated for this store.");
    },
    onError: (e) => onMutationError("Save Failed", e),
  });

  // Quick-fill helpers
  const applyToWeekdays = () => {
    const mon = hours?.[1];
    if (!mon) return;
    setHours((prev) => {
      const next = { ...prev };
      [2, 3, 4, 5].forEach((dow) => {
        next[dow] = { ...prev[dow], is_open: mon.is_open, open_time: mon.open_time, close_time: mon.close_time };
      });
      return next;
    });
  };

  if (!storeId) return <p className="py-8 text-center text-xs text-muted-foreground">No store selected.</p>;

  if (isLoading || !hours) return (
    <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading hours…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 py-8 justify-center text-destructive text-sm">
      <AlertCircle className="h-4 w-4" /> {String(error)}
    </div>
  );

  const openCount = DAYS.filter((d) => hours?.[d.dow]?.is_open).length;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Weekly Schedule
            </h3>
            <span className="text-[10px] text-muted-foreground">
              — {openCount} day{openCount !== 1 ? "s" : ""} open
            </span>
          </div>
          <button
            type="button"
            onClick={applyToWeekdays}
            className="text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            Copy Mon → Tue–Fri
          </button>
        </div>

        {/* Day rows */}
        <div className="p-4 space-y-2">
          {DAYS.map((day) => (
            <DayRow
              key={day.dow}
              day={day}
              hour={hours?.[day.dow]}
              onChange={handleChange}
            />
          ))}
        </div>
      </div>

      {/* Info callout */}
      <div className="rounded-xl border border-border/60 bg-muted/10 px-5 py-4">
        <div className="flex gap-3">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Opening hours appear on printed receipts and EOD reports. They are also used to validate shift open/close times and can trigger overtime warnings for long shifts.
          </p>
        </div>
      </div>

      {/* Save bar */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3.5">
        {saved
          ? <div className="flex items-center gap-1.5 text-xs font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Hours saved</div>
          : <p className="text-[11px] text-muted-foreground">Changes are applied store-wide immediately.</p>}
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()} className="gap-1.5 px-5">
          {save.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
            : <><Settings2 className="h-3.5 w-3.5" /> Save Hours</>}
        </Button>
      </div>
    </div>
  );
}
