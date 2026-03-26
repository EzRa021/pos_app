// features/stock_transfers/useStockTransfers.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createTransfer, sendTransfer, receiveTransfer,
  cancelTransfer, getTransfers, getTransfer,
} from "@/commands/stock_transfers";
import { useBranchStore }   from "@/stores/branch.store";
import { invalidateStock }  from "@/lib/invalidations";
import { toastSuccess, onMutationError } from "@/lib/toast";

export function useStockTransfers({ search, status, page = 1, limit = 25 } = {}) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

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
    staleTime:       60_000,
    placeholderData: (prev) => prev,
  });

  // Invalidate transfer list only — no stock movement yet
  const invalidateList = () =>
    qc.invalidateQueries({ queryKey: ["stock-transfers", storeId] });

  // Receiving a transfer restocks items — must also refresh inventory, items, POS grid
  const invalidateListAndStock = () => {
    invalidateList();
    invalidateStock(storeId); // refreshes items, pos-items, item, inventory, inv_summary, low_stock
  };

  const create  = useMutation({
    mutationFn: createTransfer,
    onSuccess: () => {
      toastSuccess("Transfer Created", "The stock transfer has been drafted and is ready to send.");
      invalidateList();
    },
    onError: (e) => onMutationError("Couldn't Create Transfer", e),
  });
  const send    = useMutation({
    mutationFn: ({ id, ...p }) => sendTransfer(id, p),
    onSuccess: () => {
      toastSuccess("Transfer Sent", "Stock is in transit and awaiting receipt at the destination.");
      invalidateList();
    },
    onError: (e) => onMutationError("Couldn't Send Transfer", e),
  });
  const receive = useMutation({
    mutationFn: ({ id, ...p }) => receiveTransfer(id, p),
    onSuccess: () => {
      toastSuccess("Transfer Received", "Stock has been received and inventory levels updated.");
      invalidateListAndStock();
    },
    onError: (e) => onMutationError("Couldn't Receive Transfer", e),
  });
  const cancel  = useMutation({
    mutationFn: cancelTransfer,
    onSuccess: () => {
      toastSuccess("Transfer Cancelled", "The stock transfer has been cancelled.");
      invalidateList();
    },
    onError: (e) => onMutationError("Couldn't Cancel Transfer", e),
  });

  return {
    storeId,
    transfers: data?.data ?? [],
    total:     data?.total ?? 0,
    isLoading,
    isFetching,
    create, send, receive, cancel,
  };
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

  const send    = useMutation({
    mutationFn: (p) => sendTransfer(id, p),
    onSuccess: () => {
      toastSuccess("Transfer Sent", "Stock is in transit and awaiting receipt at the destination.");
      invalidateDetail();
    },
    onError: (e) => onMutationError("Couldn't Send Transfer", e),
  });
  const receive = useMutation({
    mutationFn: (p) => receiveTransfer(id, p),
    onSuccess: () => {
      toastSuccess("Transfer Received", "Stock has been received and inventory levels updated.");
      invalidateDetailAndStock();
    },
    onError: (e) => onMutationError("Couldn't Receive Transfer", e),
  });
  const cancel  = useMutation({
    mutationFn: () => cancelTransfer(id),
    onSuccess: () => {
      toastSuccess("Transfer Cancelled", "The stock transfer has been cancelled.");
      invalidateDetail();
    },
    onError: (e) => onMutationError("Couldn't Cancel Transfer", e),
  });

  return { transfer: data, isLoading, error: error ?? null, send, receive, cancel };
}
