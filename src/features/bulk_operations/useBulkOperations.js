// features/bulk_operations/useBulkOperations.js
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  bulkPriceUpdate, bulkStockAdjustment, bulkItemImport,
  bulkActivateItems, bulkDeactivateItems, bulkApplyDiscount,
} from "@/commands/bulk_operations";
import { useBranchStore } from "@/stores/branch.store";
import { invalidateStock } from "@/lib/invalidations";
import { toastSuccess, onMutationError } from "@/lib/toast";

export function useBulkOperations() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  // Invalidate every cache that bulk writes touch:
  // items list (all filter variants), POS grid, inventory, stat cards
  const invalidateAll = () => {
    invalidateStock(storeId);              // busts items, pos-items, inventory, inv_summary, low_stock
    qc.invalidateQueries({ queryKey: ["inv_summary", storeId] });
  };

  const priceUpdate     = useMutation({
    mutationFn: (p) => bulkPriceUpdate({ store_id: storeId, ...p }),
    onSuccess: (r) => {
      toastSuccess("Prices Updated", `${r?.updated_count ?? "All selected"} item prices have been updated.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Bulk Price Update Failed", e),
  });

  const stockAdjust     = useMutation({
    mutationFn: (p) => bulkStockAdjustment({ store_id: storeId, ...p }),
    onSuccess: (r) => {
      toastSuccess("Stock Adjusted", `${r?.updated_count ?? "All selected"} item stock levels have been updated.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Bulk Stock Adjustment Failed", e),
  });

  const itemImport      = useMutation({
    mutationFn: (p) => bulkItemImport({ store_id: storeId, ...p }),
    onSuccess: (r) => {
      toastSuccess("Items Imported", `${r?.imported_count ?? "All"} items have been added to your catalog.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Import Failed", e),
  });

  const activateItems   = useMutation({
    mutationFn: (p) => bulkActivateItems({ store_id: storeId, ...p }),
    onSuccess: (r) => {
      toastSuccess("Items Activated", `${r?.updated_count ?? "Selected"} items are now visible on the POS.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Bulk Activate Failed", e),
  });

  const deactivateItems = useMutation({
    mutationFn: (p) => bulkDeactivateItems({ store_id: storeId, ...p }),
    onSuccess: (r) => {
      toastSuccess("Items Deactivated", `${r?.updated_count ?? "Selected"} items have been hidden from the POS.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Bulk Deactivate Failed", e),
  });

  const applyDiscount   = useMutation({
    mutationFn: (p) => bulkApplyDiscount({ store_id: storeId, ...p }),
    onSuccess: (r) => {
      toastSuccess("Discounts Applied", `${r?.updated_count ?? "Selected"} items have been updated with the new discount.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Bulk Discount Failed", e),
  });

  return {
    storeId,
    priceUpdate,
    stockAdjust,
    itemImport,
    activateItems,
    deactivateItems,
    applyDiscount,
  };
}
