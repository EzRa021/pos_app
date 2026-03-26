// features/wallet/useWallet.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { depositToWallet, getWalletBalance, getWalletHistory, adjustWallet } from "@/commands/customer_wallet";
import { useBranchStore } from "@/stores/branch.store";
import { toastSuccess, onMutationError } from "@/lib/toast";

export function useWalletBalance(customerId) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["wallet-balance", customerId],
    queryFn:  () => getWalletBalance(customerId),
    enabled:  !!customerId,
    staleTime: 60_000,
  });
  return { balance: data, isLoading, error: error ?? null };
}

export function useWalletHistory(customerId, limit = 50) {
  const { data, isLoading } = useQuery({
    queryKey: ["wallet-history", customerId, limit],
    queryFn:  () => getWalletHistory(customerId, limit),
    enabled:  !!customerId,
    staleTime: 60_000,
  });
  return { history: data ?? [], isLoading };
}

export function useWalletActions(customerId) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["wallet-balance",  customerId] });
    qc.invalidateQueries({ queryKey: ["wallet-history",  customerId] });
    qc.invalidateQueries({ queryKey: ["customer",        customerId] });
  };

  const deposit = useMutation({
    mutationFn: (p) => depositToWallet({ customer_id: customerId, store_id: storeId, ...p }),
    onSuccess: (_, vars) => {
      toastSuccess("Wallet Funded", `₦${Number(vars.amount).toLocaleString()} has been added to the customer's wallet.`);
      invalidate();
    },
    onError: (e) => onMutationError("Wallet Deposit Failed", e),
  });

  const adjust = useMutation({
    mutationFn: (p) => adjustWallet({ customer_id: customerId, store_id: storeId, ...p }),
    onSuccess: () => {
      toastSuccess("Wallet Adjusted", "The customer's wallet balance has been updated.");
      invalidate();
    },
    onError: (e) => onMutationError("Wallet Adjustment Failed", e),
  });

  return { deposit, adjust };
}
