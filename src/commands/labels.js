// commands/labels.js — Barcode and price tag label printing
import { rpc } from "@/lib/apiClient";

// GenerateLabelsDto: { store_id, item_ids: UUID[], copies?: i32 }
// Returns: ItemLabel[]
export const generateItemLabels = (payload) =>
  rpc("generate_item_labels", payload);

// Returns the barcode string for the item (generates if missing)
export const autoGenerateBarcode = (itemId) =>
  rpc("auto_generate_barcode", { item_id: itemId });

// PrintPriceTagsDto: { store_id, category_id?, department_id?, copies? }
export const printPriceTags = (payload) =>
  rpc("print_price_tags", payload);

// Returns the default label template for the store (or null)
export const getLabelTemplate = (storeId) =>
  rpc("get_label_template", { store_id: storeId });

// SaveLabelTemplateDto: { store_id, name, format, show_price, show_sku,
//   show_name, show_store, show_expiry, is_default }
export const saveLabelTemplate = (payload) =>
  rpc("save_label_template", payload);
