// commands/store_settings.js — Business rules per store
import { rpc } from "@/lib/apiClient";

export const getStoreSettings = (storeId) =>
  rpc("get_store_settings", { store_id: storeId });

// UpdateStoreSettingsDto — all fields optional (COALESCE patch on backend):
// allow_price_override, max_discount_percent, require_discount_reason,
// warn_sell_below_cost, allow_sell_below_cost, require_customer_above_amount,
// void_same_day_only, max_void_amount, require_manager_approval_void_above,
// receipt_header_text, receipt_footer_text, show_vat_on_receipt,
// show_cashier_on_receipt, receipt_copies, auto_create_po_on_reorder,
// opening_float_required, min_opening_float, max_credit_days,
// auto_flag_overdue_after_days
export const updateStoreSettings = (payload) =>
  rpc("update_store_settings", payload);
