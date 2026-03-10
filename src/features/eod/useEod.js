// features/eod/useEod.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import { generateEodReport, lockEodReport, getEodReport, getEodHistory } from "@/commands/eod";

export function useEodReport(date) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["eod", storeId, date],
    queryFn:  () => getEodReport(storeId, date),
    enabled:  !!storeId && !!date,
    staleTime: 5 * 60_000,
  });

  const generate = useMutation({
    mutationFn: () => generateEodReport(storeId, date),
    onSuccess:  (d) => {
      qc.setQueryData(["eod", storeId, date], d);
      qc.invalidateQueries({ queryKey: ["eod-history", storeId] });
    },
  });

  const lock = useMutation({
    mutationFn: (id) => lockEodReport(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["eod", storeId, date] }),
  });

  return { report: data ?? null, isLoading, error: error ?? null, refetch, generate, lock };
}

export function useEodHistory(filters = {}) {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data, isLoading } = useQuery({
    queryKey: ["eod-history", storeId, filters],
    queryFn:  () => getEodHistory({ store_id: storeId, ...filters }),
    enabled:  !!storeId,
    staleTime: 2 * 60_000,
  });

  return { history: data ?? [], isLoading };
}
