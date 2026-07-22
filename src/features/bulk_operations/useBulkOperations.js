// features/bulk_operations/useBulkOperations.js
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  bulkPriceUpdate, bulkStockAdjustment,
  bulkActivateItems, bulkDeactivateItems, bulkApplyDiscount,
} from "@/commands/bulk_operations";
import { useBranchStore } from "@/stores/branch.store";
import { invalidateStock } from "@/lib/invalidations";

// NOTE: these mutations intentionally do NOT toast. Every caller (the bulk
// dialogs and the ItemsTable selection bar) shows its own success/error toast
// with the real `affected` count from the response — toasting here as well
// produced two toasts per action. The hook only owns cache invalidation.
export function useBulkOperations() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  // Invalidate every cache that bulk writes touch:
  // items list (all filter variants), POS grid, inventory, stat cards
  const invalidateAll = () => {
    invalidateStock(storeId);              // busts items, pos-items, inventory, inv_summary, low_stock
    qc.invalidateQueries({ queryKey: ["inv_summary", storeId] });
  };

  const priceUpdate = useMutation({
    mutationFn: (p) => bulkPriceUpdate({ store_id: storeId, ...p }),
    onSuccess:  invalidateAll,
  });

  const stockAdjust = useMutation({
    mutationFn: (p) => bulkStockAdjustment({ store_id: storeId, ...p }),
    onSuccess:  invalidateAll,
  });

  const activateItems = useMutation({
    mutationFn: (p) => bulkActivateItems({ store_id: storeId, ...p }),
    onSuccess:  invalidateAll,
  });

  const deactivateItems = useMutation({
    mutationFn: (p) => bulkDeactivateItems({ store_id: storeId, ...p }),
    onSuccess:  invalidateAll,
  });

  const applyDiscount = useMutation({
    mutationFn: (p) => bulkApplyDiscount({ store_id: storeId, ...p }),
    onSuccess:  invalidateAll,
  });

  return {
    storeId,
    priceUpdate,
    stockAdjust,
    activateItems,
    deactivateItems,
    applyDiscount,
  };
}
