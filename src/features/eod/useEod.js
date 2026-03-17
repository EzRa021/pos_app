// features/eod/useEod.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { generateEodReport, lockEodReport, getEodReport, getEodHistory, getEodBreakdown } from "@/commands/eod";
import { useBranchStore } from "@/stores/branch.store";

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
      qc.setQueryData(["eod", storeId, date], d);
      qc.invalidateQueries({ queryKey: ["eod-history", storeId] });
    },
  });

  const lock = useMutation({
    mutationFn: (id) => lockEodReport(id),
    onSuccess: (d) => {
      qc.setQueryData(["eod", storeId, date], d);
      qc.invalidateQueries({ queryKey: ["eod-history", storeId] });
    },
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
