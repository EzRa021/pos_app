// commands/expense_categories.js — Expense category management
import { rpc } from "@/lib/apiClient";

export const getExpenseCategories = (storeId) =>
  rpc("get_expense_categories", { store_id: storeId ?? null });

export const createExpenseCategory = (payload) =>
  rpc("create_expense_category", payload);
// payload: { store_id?, name, description? }

export const updateExpenseCategory = (id, payload) =>
  rpc("update_expense_category", { id, ...payload });
// payload: { name?, description?, is_active? }

export const deleteExpenseCategory = (id) =>
  rpc("delete_expense_category", { id });
