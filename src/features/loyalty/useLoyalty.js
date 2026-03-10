// features/loyalty/useLoyalty.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getLoyaltyBalance, getLoyaltyHistory,
  earnPoints, redeemPoints, adjustPoints,
} from "@/commands/loyalty";

export function useLoyaltyBalance(customerId) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const { data, isLoading, error } = useQuery({
    queryKey: ["loyalty-balance", customerId, storeId],
    queryFn:  () => getLoyaltyBalance(customerId, storeId),
    enabled:  !!customerId && !!storeId,
    staleTime: 60_000,
  });
  return { balance: data, isLoading, error: error ?? null };
}

export function useLoyaltyHistory(customerId, limit = 50) {
  const { data, isLoading } = useQuery({
    queryKey: ["loyalty-history", customerId, limit],
    queryFn:  () => getLoyaltyHistory(customerId, limit),
    enabled:  !!customerId,
    staleTime: 60_000,
  });
  return { history: data ?? [], isLoading };
}

export function useLoyaltyActions(customerId) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["loyalty-balance",  customerId] });
    qc.invalidateQueries({ queryKey: ["loyalty-history",  customerId] });
  };

  const earn = useMutation({
    mutationFn: (p) => earnPoints({ customer_id: customerId, store_id: storeId, ...p }),
    onSuccess:  invalidate,
  });
  const redeem = useMutation({
    mutationFn: (p) => redeemPoints({ customer_id: customerId, store_id: storeId, ...p }),
    onSuccess:  invalidate,
  });
  const adjust = useMutation({
    mutationFn: (p) => adjustPoints({ customer_id: customerId, store_id: storeId, ...p }),
    onSuccess:  invalidate,
  });

  return { earn, redeem, adjust };
}
