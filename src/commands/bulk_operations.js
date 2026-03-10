// commands/bulk_operations.js — Bulk price updates, stock adjustments, imports
import { rpc } from "@/lib/apiClient";

// BulkPriceUpdateDto: { store_id, category_id?, department_id?,
//   method: "percentage"|"fixed_increase"|"fixed_decrease"|"set_absolute",
//   value: f64, round_to?: f64, update_cost?: bool, reason?: string }
export const bulkPriceUpdate = (payload) =>
  rpc("bulk_price_update", payload);

// BulkStockAdjustmentDto: { store_id,
//   items: [{ item_id: UUID, adjustment: f64, reason?: string }] }
export const bulkStockAdjustment = (payload) =>
  rpc("bulk_stock_adjustment", payload);

// BulkItemImportDto: { store_id,
//   items: [{ item_name, sku?, barcode?, cost_price, selling_price,
//             category_id?, department_id?, unit? }] }
export const bulkItemImport = (payload) =>
  rpc("bulk_item_import", payload);

// BulkToggleItemsDto: { store_id, item_ids?: UUID[], category_id?, department_id? }
export const bulkActivateItems = (payload) =>
  rpc("bulk_activate_items", payload);

export const bulkDeactivateItems = (payload) =>
  rpc("bulk_deactivate_items", payload);

// BulkApplyDiscountDto: { store_id, category_id?, department_id?, percent: f64 }
// percent=0 clears existing discounts
export const bulkApplyDiscount = (payload) =>
  rpc("bulk_apply_discount", payload);
