// features/wallet/useWallet.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { depositToWallet, getWalletBalance, getWalletHistory, adjustWallet } from "@/commands/customer_wallet";
import { useBranchStore } from "@/stores/branch.store";

export function useWalletBalance(customerId) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["wallet-balance", customerId],
    queryFn:  () => getWalletBalance(customerId),
    enabled:  !!customerId,
    staleTime: 60_000,
  });
  return { balance: data, isLoading, error: error ?? null };
}

export function useWalletHistory(customerId, { page = 1, limit = 50 } = {}) {
  const { data, isLoading } = useQuery({
    queryKey: ["wallet-history", customerId, page, limit],
    queryFn:  () => getWalletHistory(customerId, { page, limit }),
    enabled:  !!customerId,
    staleTime: 60_000,
  });
  const history = data?.data ?? [];
  const total   = data?.total ?? 0;
  return { history, total, isLoading };
}

export function useWalletActions(customerId) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["wallet-balance",  customerId] });
    qc.invalidateQueries({ queryKey: ["wallet-history",  customerId] });
    qc.invalidateQueries({ queryKey: ["customer",        customerId] });
    qc.invalidateQueries({ queryKey: ["customers"] });
  };

  // Callers (WalletPanel dialogs, WalletPage quick-deposit) own their own
  // success/error toasts — the hook only invalidates to avoid double toasts.
  const deposit = useMutation({
    mutationFn: (p) => depositToWallet({ customer_id: customerId, store_id: storeId, ...p }),
    onSuccess: invalidate,
  });

  const adjust = useMutation({
    mutationFn: (p) => adjustWallet({ customer_id: customerId, store_id: storeId, ...p }),
    onSuccess: invalidate,
  });

  return { deposit, adjust };
}
