// commands/loyalty.js — Loyalty points engine
import { rpc } from "@/lib/apiClient";

export const getLoyaltySettings = (storeId) =>
  rpc("get_loyalty_settings", { store_id: storeId });

// UpdateLoyaltySettingsDto: { store_id, points_per_naira?, naira_per_point_redemption?,
//                             min_redemption_points?, expiry_days?, is_active? }
export const updateLoyaltySettings = (payload) =>
  rpc("update_loyalty_settings", payload);

// Returns: { customer_id, points, naira_value }
export const getLoyaltyBalance = (customerId, storeId) =>
  rpc("get_loyalty_balance", { customer_id: customerId, store_id: storeId });

export const getLoyaltyHistory = (customerId, limit = 50) =>
  rpc("get_loyalty_history", { customer_id: customerId, limit });

// EarnPointsDto: { customer_id, store_id, transaction_id?, sale_amount }
export const earnPoints = (payload) =>
  rpc("earn_points", payload);

// RedeemPointsDto: { customer_id, store_id, transaction_id?, points }
export const redeemPoints = (payload) =>
  rpc("redeem_points", payload);

// AdjustPointsDto: { customer_id, store_id, points, notes? }
export const adjustPoints = (payload) =>
  rpc("adjust_points", payload);

export const expireOldPoints = (storeId) =>
  rpc("expire_old_points", { store_id: storeId });
