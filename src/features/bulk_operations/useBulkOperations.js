// features/bulk_operations/useBulkOperations.js
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  bulkPriceUpdate, bulkStockAdjustment, bulkItemImport,
  bulkActivateItems, bulkDeactivateItems, bulkApplyDiscount,
} from "@/commands/bulk_operations";
import { useBranchStore } from "@/stores/branch.store";

export function useBulkOperations() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  const invalidateItems = () => {
    qc.invalidateQueries({ queryKey: ["items"] });
    qc.invalidateQueries({ queryKey: ["inventory"] });
  };

  const priceUpdate    = useMutation({ mutationFn: (p) => bulkPriceUpdate({ store_id: storeId, ...p }),       onSuccess: invalidateItems });
  const stockAdjust    = useMutation({ mutationFn: (p) => bulkStockAdjustment({ store_id: storeId, ...p }),   onSuccess: invalidateItems });
  const itemImport     = useMutation({ mutationFn: (p) => bulkItemImport({ store_id: storeId, ...p }),        onSuccess: invalidateItems });
  const activateItems  = useMutation({ mutationFn: (p) => bulkActivateItems({ store_id: storeId, ...p }),     onSuccess: invalidateItems });
  const deactivateItems = useMutation({ mutationFn: (p) => bulkDeactivateItems({ store_id: storeId, ...p }),  onSuccess: invalidateItems });
  const applyDiscount  = useMutation({ mutationFn: (p) => bulkApplyDiscount({ store_id: storeId, ...p }),     onSuccess: invalidateItems });

  return { storeId, priceUpdate, stockAdjust, itemImport, activateItems, deactivateItems, applyDiscount };
}
