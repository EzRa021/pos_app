// ============================================================================
// commands/items.js — Product catalog item API
// ============================================================================
// All calls go through rpc(). Token injected automatically by apiClient.js.
// Backend returns Decimal as strings ("1500.0000") — use parseFloat() to display.
// ============================================================================
import { rpc } from "@/lib/apiClient";

// ── Queries ───────────────────────────────────────────────────────────────────

/** Paginated list. filters: { store_id, page, limit, search, category_id,
 *  department_id, is_active, available_for_pos, low_stock }
 *  Returns PagedResult<Item>. */
export const getItems = (filters = {}) => rpc("get_items", filters);

/** Single item by UUID. Returns Item. */
export const getItem = (id) => rpc("get_item", { id });

/** Lookup by barcode (POS scanner). Returns Item | null. */
export const getItemByBarcode = (barcode, storeId = null) =>
  rpc("get_item_by_barcode", { barcode, store_id: storeId });

/** Lookup by SKU. Returns Item | null. */
export const getItemBySku = (sku, storeId = null) =>
  rpc("get_item_by_sku", { sku, store_id: storeId });

/** Fast text search for POS autocomplete. Returns ItemSearchResult[]. */
export const searchItems = (query, storeId = null, limit = 10) =>
  rpc("search_items", { query, store_id: storeId, limit });

/** Count items matching filters. Returns i64. */
export const countItems = (storeId = null, categoryId = null, isActive = null) =>
  rpc("count_items", { store_id: storeId, category_id: categoryId, is_active: isActive });

/** Paginated item_history for one item. Returns PagedResult<ItemHistory>.
 *  filters: { page?, limit?, date_from? (YYYY-MM-DD), date_to? (YYYY-MM-DD), event_type? } */
export const getItemHistory = (itemId, filters = {}) =>
  rpc("get_item_history", { item_id: itemId, ...filters });

// ── Mutations ─────────────────────────────────────────────────────────────────

/** Create a new item + settings + initial stock. Returns full Item. */
export const createItem = (payload) => rpc("create_item", payload);
// payload: { store_id, category_id, department_id?, sku, barcode?, item_name,
//   description?, cost_price, selling_price, discount_price?,
//   is_active?, sellable?, available_for_pos?, track_stock?, taxable?,
//   allow_discount?, max_discount_percent?, unit_type?, unit_value?,
//   requires_weight?, allow_negative_stock?,
//   min_stock_level?, max_stock_level?, initial_quantity? }

/** Partial update. Omit fields to leave them unchanged. Returns full Item. */
export const updateItem = (id, payload) => rpc("update_item", { id, ...payload });

/** Soft-archive: sets archived_at = NOW() + is_active = FALSE. No undo via UI. */
export const archiveItem = (id) => rpc("delete_item", { id });

/** Remove the image from an item (sets image_data = null). Returns updated Item. */
export const removeItemImage = (id) => rpc("remove_item_image", { id });

/** Activate: sets is_active = TRUE. */
export const activateItem = (id) => rpc("activate_item", { id });

/** Deactivate: sets is_active = FALSE (does NOT archive). */
export const deactivateItem = (id) => rpc("deactivate_item", { id });

/**
 * Adjust stock by a signed delta.
 * payload: { item_id, store_id, adjustment (signed float),
 *            adjustment_type? ("ADJUSTMENT"|"RESTOCK"|"DAMAGE"|"THEFT"|"LOSS"|"CORRECTION"),
 *            notes? }
 * Returns updated Item.
 */
export const adjustStock = (payload) => rpc("adjust_stock", payload);
