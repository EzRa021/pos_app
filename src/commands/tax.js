// commands/tax.js — Tax categories
import { rpc } from "@/lib/apiClient";

export const getTaxCategories = () =>
  rpc("get_tax_categories");

export const createTaxCategory = (payload) =>
  rpc("create_tax_category", payload);
// payload: { name, code, rate, is_inclusive, description? }

export const updateTaxCategory = (id, payload) =>
  rpc("update_tax_category", { id, ...payload });
// payload: { name?, rate?, is_inclusive?, description?, is_active? }

export const deleteTaxCategory = (id) =>
  rpc("delete_tax_category", { id });
