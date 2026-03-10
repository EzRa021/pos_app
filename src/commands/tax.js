// commands/tax.js — Tax categories
import { rpc } from "@/lib/apiClient";

export const getTaxCategories = (storeId) =>
  rpc("get_tax_categories", { store_id: storeId });

export const createTaxCategory = (payload) =>
  rpc("create_tax_category", payload);
// payload: { store_id, name, rate, description? }

export const updateTaxCategory = (id, payload) =>
  rpc("update_tax_category", { id, ...payload });
