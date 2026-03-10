// commands/expenses.js — Expense management
import { rpc } from "@/lib/apiClient";

export const getExpenses = (params = {}) =>
  rpc("get_expenses", params);
// params: { store_id?, expense_type?, approval_status?, payment_status?,
//           date_from?, date_to?, page?, limit? }

export const getExpense = (id) =>
  rpc("get_expense", { id });

export const getExpenseSummary = (storeId, dateFrom, dateTo) =>
  rpc("get_expense_summary", {
    store_id:  storeId,
    date_from: dateFrom || undefined,
    date_to:   dateTo   || undefined,
  });

export const getExpenseBreakdown = (storeId, dateFrom, dateTo) =>
  rpc("get_expense_breakdown", {
    store_id:  storeId,
    date_from: dateFrom || undefined,
    date_to:   dateTo   || undefined,
  });

export const createExpense = (payload) =>
  rpc("create_expense", payload);
// payload: { store_id, category, expense_type?, description, amount,
//            paid_to?, payment_method, expense_date?, is_recurring?, is_deductible?, notes? }

export const updateExpense = (id, payload) =>
  rpc("update_expense", { id, ...payload });

export const approveExpense = (id) =>
  rpc("approve_expense", { id });

export const rejectExpense = (id) =>
  rpc("reject_expense", { id });

export const deleteExpense = (id) =>
  rpc("delete_expense", { id });
