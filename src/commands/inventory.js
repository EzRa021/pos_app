// ============================================================================
// commands/inventory.js — Inventory, stock counts, movements
// ============================================================================
import { rpc } from "@/lib/apiClient";

// ── Inventory queries ─────────────────────────────────────────────────────────

/** Paginated stock levels for all tracked items.
 *  filters: { store_id, page, limit, search, category_id,
 *             department_id, low_stock, measurement_type }
 *  Returns PagedResult<InventoryRecord>. */
export const getInventory = (filters = {}) => rpc("get_inventory", filters);

/** Full detail for one item (includes last 20 movements). */
export const getInventoryItem = (itemId, storeId) =>
  rpc("get_inventory_item", { item_id: itemId, store_id: storeId });

/** Items at or below min_stock_level. Returns LowStockItem[]. */
export const getLowStock = (storeId = null, limit = 50) =>
  rpc("get_low_stock", { store_id: storeId, limit });

/** Store-level summary (total items, low-stock count, total value, etc.). */
export const getInventorySummary = (storeId) =>
  rpc("get_inventory_summary", { store_id: storeId });

/** Movement history across all items (filterable).
 *  filters: { item_id?, event_type?, performed_by?,
 *             start_date?, end_date?, page?, limit? } */
export const getMovementHistory = (storeId, filters = {}) =>
  rpc("get_movement_history", { store_id: storeId, ...filters });

// ── Inventory mutations ───────────────────────────────────────────────────────

/** Restock (always positive). Returns RestockResult. */
export const restockItem = (itemId, storeId, quantity, note = null) =>
  rpc("restock_item", { item_id: itemId, store_id: storeId, quantity, note });

/** Inventory adjustment with reason.
 *  reason: "damage" | "theft" | "audit" | "correction" | "loss" | "other" */
export const adjustInventory = (itemId, storeId, adjustmentQuantity, reason, notes = null) =>
  rpc("adjust_inventory", {
    item_id:             itemId,
    store_id:            storeId,
    adjustment_quantity: adjustmentQuantity,
    reason,
    notes,
  });

// ── Stock count pipeline ──────────────────────────────────────────────────────

/** Aggregate stats for a store (from v_stock_count_stats view).
 *  Returns { total_count, in_progress_count, completed_count,
 *            cancelled_count, total_variance_value, total_items_with_variance } */
export const getStockCountStats = (storeId) =>
  rpc("get_stock_count_stats", { store_id: storeId });

/** Start a new count session. Returns StockCount. */
export const startCountSession = (storeId, countType = "full", notes = null) =>
  rpc("start_count_session", { store_id: storeId, count_type: countType, notes });

/** Cancel an in-progress count session. Returns updated StockCount. */
export const cancelCountSession = (sessionId, storeId, reason = null) =>
  rpc("cancel_count_session", { session_id: sessionId, store_id: storeId, reason });

/** Get all items already recorded in a session (counted items). */
export const getSessionCountItems = (sessionId, storeId) =>
  rpc("get_session_count_items", { session_id: sessionId, store_id: storeId });

/** Record a single item's counted quantity. Returns StockCountItem. */
export const recordCount = (sessionId, storeId, itemId, countedQuantity, notes = null) =>
  rpc("record_count", {
    session_id:       sessionId,
    store_id:         storeId,
    item_id:          itemId,
    counted_quantity: countedQuantity,
    notes,
  });

/** Finish the session and optionally apply all variances to stock. */
export const completeCountSession = (sessionId, storeId, applyVariances = false) =>
  rpc("complete_count_session", {
    session_id:      sessionId,
    store_id:        storeId,
    apply_variances: applyVariances,
  });

/** Apply variances for an already-completed session. */
export const applyVariancesStandalone = (sessionId, storeId) =>
  rpc("apply_variances_standalone", { session_id: sessionId, store_id: storeId });

/** Full variance report for a session. Returns VarianceReport. */
export const getVarianceReport = (sessionId, storeId) =>
  rpc("get_variance_report", { session_id: sessionId, store_id: storeId });

/** Single count session. Returns StockCount. */
export const getCountSession = (sessionId, storeId) =>
  rpc("get_count_session", { session_id: sessionId, store_id: storeId });

/** Paginated list of count sessions.
 *  filters: { store_id?, status?, count_type?, search?, page?, limit? } */
export const getCountSessions = (filters = {}) =>
  rpc("get_count_sessions", filters);

/**
 * Returns ALL active, tracked items for a store — no pagination.
 * Used exclusively by the StockCountRunner to build its full item list.
 * Replaces the previous useInventory({ limit: 200 }) workaround.
 */
export const getInventoryForCount = (storeId) =>
  rpc("get_inventory_for_count", { store_id: storeId });
