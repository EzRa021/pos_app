// commands/price_management.js — Price lists, change requests, and scheduling
import { rpc } from "@/lib/apiClient";

// ── Price Lists ───────────────────────────────────────────────────────────────

// PriceListFilters: { store_id?, list_type?, page?, limit? }
export const getPriceLists = (params = {}) =>
  rpc("get_price_lists", params);

// CreatePriceListDto: { store_id, list_name, list_type, description? }
export const createPriceList = (payload) =>
  rpc("create_price_list", payload);

// UpdatePriceListDto: { id, list_name?, description?, is_active? }
export const updatePriceList = (id, payload) =>
  rpc("update_price_list", { id, ...payload });

export const deletePriceList = (id) =>
  rpc("delete_price_list", { id });

// ── Price List Items ──────────────────────────────────────────────────────────

// AddPriceListItemDto: { price_list_id, item_id, price, effective_from?, effective_to? }
export const addPriceListItem = (payload) =>
  rpc("add_price_list_item", payload);

export const getPriceListItems = (priceListId) =>
  rpc("get_price_list_items", { price_list_id: priceListId });

// ── Price Change Requests ─────────────────────────────────────────────────────

// RequestPriceChangeDto: { item_id, store_id, new_price, reason, change_type, effective_at? }
export const requestPriceChange = (payload) =>
  rpc("request_price_change", payload);

// Immediately applies new_price to the item's selling_price
export const approvePriceChange = (id) =>
  rpc("approve_price_change", { id });

export const rejectPriceChange = (id) =>
  rpc("reject_price_change", { id });

// params: { store_id?, status?, page?, limit? }
export const getPriceChanges = (params = {}) =>
  rpc("get_price_changes", params);

// ── Scheduled Price Changes ───────────────────────────────────────────────────

// SchedulePriceChangeDto: { item_id, store_id, new_selling_price, new_cost_price?,
//                           change_reason?, effective_at (ISO string, must be future) }
export const schedulePriceChange = (payload) =>
  rpc("schedule_price_change", payload);

export const cancelScheduledPriceChange = (id) =>
  rpc("cancel_scheduled_price_change", { id });

// Returns all non-cancelled scheduled changes for the store
// include_applied: false (default) = only pending; true = include already-applied
export const getPendingScheduledChanges = (storeId, includeApplied = false) =>
  rpc("get_pending_price_changes", { store_id: storeId, include_applied: includeApplied });

// Applies all scheduled changes whose effective_at has passed
export const applyScheduledPrices = () =>
  rpc("apply_scheduled_prices");

// ── Price History ─────────────────────────────────────────────────────────────

// Full audit trail for a specific item (from price_scheduling module)
export const getItemPriceHistory = (itemId, storeId, limit = 50) =>
  rpc("get_item_price_history", { item_id: itemId, store_id: storeId, limit });
