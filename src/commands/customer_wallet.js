// commands/customer_wallet.js — Customer prepaid wallet / advance payments
import { rpc } from "@/lib/apiClient";

// DepositDto: { customer_id, store_id, amount, reference?, notes? }
export const depositToWallet = (payload) =>
  rpc("deposit_to_wallet", payload);

// Returns: { customer_id, customer_name, balance, total_deposited, total_spent }
export const getWalletBalance = (customerId) =>
  rpc("get_wallet_balance", { customer_id: customerId });

export const getWalletHistory = (customerId, limit = 50) =>
  rpc("get_wallet_history", { customer_id: customerId, limit });

// AdjustWalletDto: { customer_id, store_id, amount (signed), notes? }
export const adjustWallet = (payload) =>
  rpc("adjust_wallet", payload);
