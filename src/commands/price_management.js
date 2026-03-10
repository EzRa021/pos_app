// commands/price_management.js — Price lists and change requests
import { rpc } from "@/lib/apiClient";

export const getPriceLists = (storeId) =>
  rpc("get_price_lists", { store_id: storeId });

export const createPriceList = (payload) =>
  rpc("create_price_list", payload);
// payload: { store_id, name, description?, is_default? }

export const addPriceListItem = (priceListId, itemId, price) =>
  rpc("add_price_list_item", { price_list_id: priceListId, item_id: itemId, price });

export const getPriceListItems = (priceListId) =>
  rpc("get_price_list_items", { price_list_id: priceListId });

export const requestPriceChange = (payload) =>
  rpc("request_price_change", payload);
// payload: { item_id, store_id, new_price, reason? }

export const approvePriceChange = (id, approved, notes = "") =>
  rpc("approve_price_change", { id, approved, notes });

export const getPriceChanges = (params = {}) =>
  rpc("get_price_changes", params);
// params: { store_id?, status?, page?, page_size? }
