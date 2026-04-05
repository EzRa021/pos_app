// ============================================================================
// commands/pos_favourites.js — POS quick-access favourites
// ============================================================================
import { rpc } from "@/lib/apiClient";

export const getPosFavourites  = (storeId)          => rpc("get_pos_favourites",  { store_id: storeId });
export const addPosFavourite   = (storeId, itemId)  => rpc("add_pos_favourite",   { store_id: storeId, item_id: itemId });
export const removePosFavourite = (storeId, itemId) => rpc("remove_pos_favourite", { store_id: storeId, item_id: itemId });
