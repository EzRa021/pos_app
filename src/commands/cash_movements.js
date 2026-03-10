// commands/cash_movements.js — Cash drawer movement commands
// Field names match src-tauri/src/models/shift.rs exactly.
// Mirrors quantum-pos-app recordDeposit / recordWithdrawal / recordPayout.
import { rpc } from "@/lib/apiClient";

// ── Cash movements ────────────────────────────────────────────────────────────
// CreateCashMovementDto: { shift_id, movement_type, amount, reason?, reference_number? }
// movement_type: "deposit" | "withdrawal" | "payout"
//   deposit    → cash added to drawer  (top-up, change fund)
//   withdrawal → cash removed          (bank drop, safe deposit)
//   payout     → expense from drawer   (supplier, cleaning, etc.)

export const addCashMovement = (payload) =>
  rpc("add_cash_movement", payload);
  // payload: { shift_id, movement_type, amount, reason?, reference_number? }

export const getCashMovements = (shiftId) =>
  rpc("get_cash_movements", { shift_id: shiftId });

// ── Shift summary (used by CloseShiftModal) ───────────────────────────────────
// Returns: { shift_id, opening_float, total_sales, total_returns,
//            total_deposits, total_withdrawals, total_payouts, expected_balance }

export const getShiftSummary = (shiftId) =>
  rpc("get_shift_summary", { shift_id: shiftId });
