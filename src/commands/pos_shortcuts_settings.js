// commands/pos_shortcuts_settings.js — Admin-configured POS pinned items
import { rpc } from "@/lib/apiClient";

export const getPosShortcuts = (storeId) =>
  rpc("get_pos_shortcuts", { store_id: storeId });

export const addPosShortcut = (storeId, itemId, position) =>
  rpc("add_pos_shortcut", { store_id: storeId, item_id: itemId, position });

export const removePosShortcut = (storeId, itemId) =>
  rpc("remove_pos_shortcut", { store_id: storeId, item_id: itemId });

export const reorderPosShortcuts = (storeId, order) =>
  rpc("reorder_pos_shortcuts", { store_id: storeId, order });
// order: UUID[] of item_id in desired slot order (index = position)
