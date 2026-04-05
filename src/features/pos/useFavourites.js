// ============================================================================
// features/pos/useFavourites.js — shared hook for POS quick-access favourites
// ============================================================================
import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import { getPosFavourites, addPosFavourite, removePosFavourite } from "@/commands/pos_favourites";

export function useFavourites() {
  const storeId     = useBranchStore((s) => s.activeStore?.id);
  const qc          = useQueryClient();
  const queryKey    = useMemo(() => ["pos-favourites", storeId], [storeId]);

  const { data: favsRaw, isLoading } = useQuery({
    queryKey,
    queryFn:   () => getPosFavourites(storeId),
    enabled:   !!storeId,
    staleTime: 5 * 60_000,
  });

  const favourites = useMemo(() => favsRaw ?? [], [favsRaw]);

  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey }), [qc, queryKey]);

  const pinMutation = useMutation({
    mutationFn: (itemId) => addPosFavourite(storeId, itemId),
    onSuccess: invalidate,
  });
  const unpinMutation = useMutation({
    mutationFn: (itemId) => removePosFavourite(storeId, itemId),
    onSuccess: invalidate,
  });

  const isPinned  = useCallback((itemId) => favourites.some((f) => f.id === itemId), [favourites]);
  const pinItem   = useCallback((itemId) => pinMutation.mutate(itemId),   [pinMutation]);
  const unpinItem = useCallback((itemId) => unpinMutation.mutate(itemId), [unpinMutation]);
  const toggle    = useCallback((itemId) => {
    isPinned(itemId) ? unpinItem(itemId) : pinItem(itemId);
  }, [isPinned, pinItem, unpinItem]);

  return {
    favourites,
    isLoading,
    isPinned,
    pinItem,
    unpinItem,
    toggle,
    isPending: pinMutation.isPending || unpinMutation.isPending,
  };
}
