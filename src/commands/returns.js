// ============================================================================
// commands/returns.js — Product returns
// ============================================================================

import { rpc } from "@/lib/apiClient";

// ── List & detail ──────────────────────────────────────────────────────────────

/**
 * Paginated, filtered list of returns.
 * @param {{ store_id?, cashier_id?, customer_id?, status?, return_type?,
 *           date_from?, date_to?, search?, page?, limit? }} params
 */
export const getReturns = (params = {}) => rpc("get_returns", params);

/** Full return detail including items. */
export const getReturn = (id) => rpc("get_return", { id });

/** All returns linked to a specific transaction. */
export const getTransactionReturns = (txId) =>
  rpc("get_transaction_returns", { tx_id: txId });

// ── Stats ──────────────────────────────────────────────────────────────────────

/**
 * Efficient single-query stats for the given store.
 * Returns { total_count, full_count, partial_count, completed_count,
 *           voided_count, total_refunded }
 */
export const getReturnStats = (storeId) =>
  rpc("get_return_stats", { store_id: storeId });

// ── Mutations ──────────────────────────────────────────────────────────────────

/**
 * Create a new return.
 * @param {{
 *   original_tx_id: number,
 *   refund_method: string,
 *   refund_reference?: string,
 *   reason: string,
 *   notes?: string,
 *   items: Array<{
 *     item_id: string,         // UUID
 *     quantity_returned: number,
 *     condition: "good"|"damaged"|"defective",
 *     restock: boolean,
 *     notes?: string
 *   }>
 * }} payload
 */
export const createReturn = (payload) => rpc("create_return", payload);

/**
 * Void an existing return. Reverses any restock and restores transaction status.
 * @param {number} id
 * @param {{ reason?: string }} payload
 */
export const voidReturn = (id, payload = {}) =>
  rpc("void_return", { id, ...payload });

// ── Per-item returned-quantity helper ─────────────────────────────────────────

/**
 * Returns [{ item_id, quantity_returned }] — total already-returned qty per
 * item for a transaction (excluding voided returns). Used by InitiateReturnModal
 * to cap quantity inputs and mark fully-returned items.
 */
export const getTransactionReturnedQty = (txId) =>
  rpc("get_transaction_returned_quantities", { tx_id: txId });

// ── Command palette search ────────────────────────────────────────────────────

/**
 * Fast text search for the command palette.
 * Returns slim results: { id, reference_no, original_ref_no, customer_name,
 *                         total_amount, return_type, status, created_at }
 */
export const searchReturns = (query, storeId, limit = 8) =>
  rpc("search_returns", { query, store_id: storeId ?? null, limit });
