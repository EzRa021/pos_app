// features/supplier_payments/useSupplierPayments.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  recordSupplierPayment, getSupplierPayments,
  getSupplierBalance, getAllSupplierPayables,
} from "@/commands/supplier_payments";
import { useBranchStore } from "@/stores/branch.store";

export function useSupplierBalance(supplierId) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["supplier-balance", supplierId],
    queryFn:  () => getSupplierBalance(supplierId),
    enabled:  !!supplierId,
    staleTime: 60_000,
  });
  return { balance: data, isLoading, error: error ?? null };
}

export function useSupplierPayments(supplierId, { page = 1, limit = 25 } = {}) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["supplier-payments", supplierId, page, limit],
    queryFn:  () => getSupplierPayments({ supplier_id: supplierId, store_id: storeId, page, limit }),
    enabled:  !!supplierId,
    staleTime: 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["supplier-payments", supplierId] });
    qc.invalidateQueries({ queryKey: ["supplier-balance",  supplierId] });
    qc.invalidateQueries({ queryKey: ["supplier-payables"] });
  };

  const record = useMutation({
    mutationFn: (p) => recordSupplierPayment({ supplier_id: supplierId, store_id: storeId, ...p }),
    onSuccess:  invalidate,
  });

  return {
    payments:   data?.data  ?? [],
    total:      data?.total ?? 0,
    isLoading,
    record,
  };
}

export function useAllSupplierPayables() {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data, isLoading } = useQuery({
    queryKey: ["supplier-payables", storeId],
    queryFn:  () => getAllSupplierPayables(storeId),
    enabled:  !!storeId,
    staleTime: 2 * 60_000,
  });

  return { payables: data ?? [], isLoading };
}
