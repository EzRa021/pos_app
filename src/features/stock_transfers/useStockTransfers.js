// features/stock_transfers/useStockTransfers.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createTransfer, sendTransfer, receiveTransfer,
  cancelTransfer, getTransfers, getTransfer,
} from "@/commands/stock_transfers";
import { useBranchStore } from "@/stores/branch.store";

export function useStockTransfers({ status, page = 1, limit = 25 } = {}) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  const queryKey = ["stock-transfers", storeId, { status, page, limit }];

  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: () => getTransfers({ store_id: storeId, status: status || undefined, page, limit }),
    enabled:  !!storeId,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["stock-transfers", storeId] });

  const create  = useMutation({ mutationFn: createTransfer,                  onSuccess: invalidate });
  const send    = useMutation({ mutationFn: ({ id, ...p }) => sendTransfer(id, p),    onSuccess: invalidate });
  const receive = useMutation({ mutationFn: ({ id, ...p }) => receiveTransfer(id, p), onSuccess: invalidate });
  const cancel  = useMutation({ mutationFn: cancelTransfer,                  onSuccess: invalidate });

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
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["stock-transfer", id],
    queryFn:  () => getTransfer(id),
    enabled:  !!id,
    staleTime: 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["stock-transfer",  id] });
    qc.invalidateQueries({ queryKey: ["stock-transfers"] });
  };

  const send    = useMutation({ mutationFn: (p) => sendTransfer(id, p),    onSuccess: invalidate });
  const receive = useMutation({ mutationFn: (p) => receiveTransfer(id, p), onSuccess: invalidate });
  const cancel  = useMutation({ mutationFn: () => cancelTransfer(id),      onSuccess: invalidate });

  return { transfer: data, isLoading, error: error ?? null, send, receive, cancel };
}
