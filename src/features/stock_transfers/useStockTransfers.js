// features/stock_transfers/useStockTransfers.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createTransfer, sendTransfer, receiveTransfer,
  cancelTransfer, getTransfers, getTransfer, executeTransfer, approveTransfer,
} from "@/commands/stock_transfers";
import { useBranchStore }   from "@/stores/branch.store";
import { invalidateStock }  from "@/lib/invalidations";
import { toastSuccess, onMutationError } from "@/lib/toast";

export function useStockTransfers({ search, status, page = 1, limit = 25 } = {}) {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const queryKey = ["stock-transfers", storeId, { search, status, page, limit }];

  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: () => getTransfers({
      store_id: storeId,
      status:   status || undefined,
      search:   search || undefined,
      page,
      limit,
    }),
    enabled:         !!storeId,
    staleTime:       30_000,
    placeholderData: (prev) => prev,
  });

  // Backend returns a PagedResult { data, total, page, total_pages }.
  const transfers  = data?.data        ?? [];
  const total      = data?.total       ?? 0;
  const totalPages = data?.total_pages ?? 1;

  return {
    storeId,
    transfers,
    total,
    totalPages,
    isLoading,
    isFetching,
  };
}

// Admin (global) users move stock instantly via execute_transfer.
export function useExecuteTransfer() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  return useMutation({
    mutationFn: executeTransfer,
    onSuccess: () => {
      toastSuccess("Transfer Complete", "Stock has been moved and inventory levels updated.");
      qc.invalidateQueries({ queryKey: ["stock-transfers", storeId] });
      invalidateStock(storeId);
    },
    onError: (e) => onMutationError("Transfer Failed", e),
  });
}

// Non-global users submit a request that lands in the pending_approval queue
// for an admin to approve. No stock moves until approval.
export function useCreateTransfer() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  return useMutation({
    mutationFn: createTransfer,
    onSuccess: () => {
      toastSuccess("Transfer Submitted", "Your transfer request is awaiting admin approval.");
      qc.invalidateQueries({ queryKey: ["stock-transfers", storeId] });
    },
    onError: (e) => onMutationError("Couldn't Submit Transfer", e),
  });
}

export function useStockTransfer(id) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["stock-transfer", id],
    queryFn:  () => getTransfer(id),
    enabled:  !!id,
    staleTime: 60_000,
  });

  const invalidateDetail = () => {
    qc.invalidateQueries({ queryKey: ["stock-transfer",  id] });
    qc.invalidateQueries({ queryKey: ["stock-transfers"] });
  };

  const invalidateDetailAndStock = () => {
    invalidateDetail();
    invalidateStock(storeId); // receiving restocks items
  };

  // These mutations intentionally do NOT toast — the detail-page dialogs and
  // handlers own their own success/error toasts. The hook only invalidates.
  const send    = useMutation({
    mutationFn: (p) => sendTransfer(id, p),
    onSuccess: invalidateDetail,
  });
  const receive = useMutation({
    mutationFn: (p) => receiveTransfer(id, p),
    onSuccess: invalidateDetailAndStock,
  });
  const cancel  = useMutation({
    mutationFn: () => cancelTransfer(id),
    onSuccess: invalidateDetail,
  });
  const approve = useMutation({
    mutationFn: () => approveTransfer(id),
    onSuccess: invalidateDetailAndStock,
  });

  return { transfer: data, isLoading, error: error ?? null, send, receive, cancel, approve };
}
