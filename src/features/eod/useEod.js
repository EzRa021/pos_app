// features/eod/useEod.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { generateEodReport, lockEodReport, getEodReport, getEodHistory, getEodBreakdown } from "@/commands/eod";
import { useBranchStore } from "@/stores/branch.store";
import { toastSuccess, onMutationError } from "@/lib/toast";

export function useEodReport(date) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["eod", storeId, date],
    queryFn:  () => getEodReport(storeId, date),
    enabled:  !!storeId && !!date,
    staleTime: 60_000,
  });

  const generate = useMutation({
    mutationFn: (d) => generateEodReport(storeId, d ?? date),
    onSuccess: (d) => {
      toastSuccess("EOD Report Generated", "Today's end-of-day summary is ready for review.");
      qc.setQueryData(["eod", storeId, date], d);
      qc.invalidateQueries({ queryKey: ["eod-history", storeId] });
    },
    onError: (e) => onMutationError("Couldn't Generate EOD Report", e),
  });

  const lock = useMutation({
    mutationFn: (id) => lockEodReport(id),
    onSuccess: (d) => {
      toastSuccess("EOD Report Locked", "The report has been locked and can no longer be edited.");
      qc.setQueryData(["eod", storeId, date], d);
      qc.invalidateQueries({ queryKey: ["eod-history", storeId] });
    },
    onError: (e) => onMutationError("Couldn't Lock EOD Report", e),
  });

  return { report: data, isLoading, error: error ?? null, refetch, generate, lock };
}

export function useEodBreakdown(date, enabled = true) {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data, isLoading } = useQuery({
    queryKey: ["eod-breakdown", storeId, date],
    queryFn:  () => getEodBreakdown(storeId, date),
    enabled:  !!storeId && !!date && enabled,
    staleTime: 2 * 60_000,
  });

  return { breakdown: data ?? null, isLoading };
}

export function useEodHistory({ dateFrom, dateTo, limit = 30 } = {}) {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data, isLoading } = useQuery({
    queryKey: ["eod-history", storeId, { dateFrom, dateTo, limit }],
    queryFn:  () => getEodHistory({ store_id: storeId, date_from: dateFrom, date_to: dateTo, limit }),
    enabled:  !!storeId,
    staleTime: 2 * 60_000,
  });

  return { history: data ?? [], isLoading };
}
