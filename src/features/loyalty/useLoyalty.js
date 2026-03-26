// features/loyalty/useLoyalty.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getLoyaltySettings, updateLoyaltySettings,
  getLoyaltyBalance, getLoyaltyHistory,
  earnPoints, redeemPoints, adjustPoints, expireOldPoints,
} from "@/commands/loyalty";
import { useBranchStore } from "@/stores/branch.store";
import { toastSuccess, onMutationError } from "@/lib/toast";

// ── Store-level settings ──────────────────────────────────────────────────────
export function useLoyaltySettings() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["loyalty-settings", storeId],
    queryFn:  () => getLoyaltySettings(storeId),
    enabled:  !!storeId,
    staleTime: 5 * 60_000,
  });

  const update = useMutation({
    mutationFn: (p) => updateLoyaltySettings({ store_id: storeId, ...p }),
    onSuccess: (d) => {
      toastSuccess("Loyalty Settings Saved", "Your loyalty programme rules have been updated.");
      qc.setQueryData(["loyalty-settings", storeId], d);
    },
    onError: (e) => onMutationError("Couldn't Save Loyalty Settings", e),
  });

  return { settings: data, isLoading, error: error ?? null, update };
}

// ── Per-customer balance + history ────────────────────────────────────────────
export function useCustomerLoyalty(customerId) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  const { data: balance, isLoading: loadingBalance } = useQuery({
    queryKey: ["loyalty-balance", customerId, storeId],
    queryFn:  () => getLoyaltyBalance(customerId, storeId),
    enabled:  !!customerId && !!storeId,
    staleTime: 60_000,
  });

  const { data: history = [], isLoading: loadingHistory } = useQuery({
    queryKey: ["loyalty-history", customerId],
    queryFn:  () => getLoyaltyHistory(customerId, 50),
    enabled:  !!customerId,
    staleTime: 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["loyalty-balance",  customerId] });
    qc.invalidateQueries({ queryKey: ["loyalty-history",  customerId] });
  };

  const earn   = useMutation({
    mutationFn: (p) => earnPoints({ customer_id: customerId, store_id: storeId, ...p }),
    onSuccess: (r) => {
      toastSuccess("Points Earned", `${r?.points_earned ?? ""} points added to customer's balance.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Earn Points", e),
  });
  const redeem = useMutation({
    mutationFn: (p) => redeemPoints({ customer_id: customerId, store_id: storeId, ...p }),
    onSuccess: (r) => {
      toastSuccess("Points Redeemed", `${r?.points_redeemed ?? ""} points deducted from customer's balance.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Redeem Points", e),
  });
  const adjust = useMutation({
    mutationFn: (p) => adjustPoints({ customer_id: customerId, store_id: storeId, ...p }),
    onSuccess: () => {
      toastSuccess("Points Adjusted", "Customer's loyalty balance has been updated.");
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Adjust Points", e),
  });
  const expire = useMutation({
    mutationFn: () => expireOldPoints(storeId),
    onSuccess: () => {
      toastSuccess("Points Expired", "Eligible expired points have been removed from balances.");
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Expire Points", e),
  });

  return {
    balance,
    history,
    isLoading: loadingBalance || loadingHistory,
    earn, redeem, adjust, expire,
  };
}
