// ============================================================================
// features/settings/settingsNav.js
// ============================================================================
// Single source of truth for the Settings information architecture.
//
// The 22 sections are grouped into 5 buckets so the nav is scannable — a flat
// list at this count forces linear scanning with no mental model to anchor on.
// `keywords` feed the sidebar search box: users look for "VAT" or "thermal",
// not the label we happened to choose.
//
// `roles` (optional) restricts a section to specific role slugs. Omit it to
// show the section to everyone who can reach /settings at all — the route is
// already gated to super_admin / admin / gm / manager in router.jsx, so this
// is a second, narrower gate for infrastructure and destructive sections only.
//
// NOTE: gating here is by ROLE, not by permission slug. There are no
// `settings.*` entries in PERMISSIONS (lib/constants.js), and usePermission()
// returns false for unknown slugs — gating on invented slugs would lock out
// every non-global user.
// ============================================================================
import {
  Receipt, Tag, Shield, SlidersHorizontal, Star, Download, Barcode,
  FileSpreadsheet, Building2, Printer, Palette, Store, Cloud, CreditCard,
  Layers, Hash, Bell, Package, Clock, Zap, Network, Rocket,
} from "lucide-react";

const ADMIN = ["super_admin", "admin"];

export const SETTINGS_GROUPS = [
  {
    id:    "business",
    label: "Business",
    items: [
      {
        id: "business", label: "Business Profile", icon: Building2,
        description: "Business name, ID, currency, and contact details",
        keywords: "company legal name currency contact address phone email",
      },
      {
        id: "stores", label: "Stores", icon: Store,
        description: "Manage branches, locations and store settings",
        keywords: "branch location outlet shop site",
      },
      {
        id: "opening-hours", label: "Opening Hours", icon: Clock,
        description: "Weekly operating hours per store",
        keywords: "trading hours schedule open close weekday timetable",
      },
      {
        id: "tax", label: "Tax", icon: Tag,
        description: "Tax categories and rate configuration",
        keywords: "vat gst sales tax rate category exempt",
      },
      {
        id: "payment-methods", label: "Payment Methods", icon: CreditCard,
        description: "Enable, rename and sort POS payment methods",
        keywords: "cash card transfer mobile money pos tender",
      },
      {
        id: "expense-categories", label: "Expense Categories", icon: Layers,
        description: "Manage categories for expense tracking",
        keywords: "spending cost overhead accounting ledger",
      },
      {
        id: "numbering", label: "Invoice Numbering", icon: Hash,
        description: "Prefix, padding and sequence per document type",
        keywords: "reference ref no sequence prefix counter document",
      },
    ],
  },
  {
    id:    "pos",
    label: "Point of Sale",
    items: [
      {
        id: "pos-shortcuts", label: "POS Shortcuts", icon: Zap,
        description: "Pin up to 12 items as quick-access POS buttons",
        keywords: "quick keys favourites pinned tiles hotkeys",
      },
      {
        id: "business-rules", label: "Business Rules", icon: SlidersHorizontal,
        description: "Pricing, void, credit, and discount enforcement",
        keywords: "discount void credit limit override policy approval",
      },
      {
        id: "receipt", label: "Receipt", icon: Receipt,
        description: "Branding, layout, QR code and print options",
        keywords: "invoice slip logo footer header qr print",
      },
      {
        id: "labels", label: "Labels", icon: Barcode,
        description: "Barcode label format, content and template",
        keywords: "barcode sticker price tag shelf template",
      },
      {
        id: "printer", label: "Printer", icon: Printer,
        description: "ESC/POS receipt and label printer selection",
        keywords: "escpos thermal usb network device paper",
      },
      {
        id: "loyalty", label: "Loyalty", icon: Star,
        description: "Points earn rate and redemption settings",
        keywords: "points rewards redeem tier member customer",
      },
    ],
  },
  {
    id:    "inventory",
    label: "Inventory & Alerts",
    items: [
      {
        id: "low-stock-defaults", label: "Low Stock Defaults", icon: Package,
        description: "Default reorder point and quantity for new items",
        keywords: "reorder threshold minimum par level replenish",
      },
      {
        id: "notification-prefs", label: "Notification Prefs", icon: Bell,
        description: "Thresholds and toggles for alert events",
        keywords: "alerts notify email push events reminder",
      },
    ],
  },
  {
    id:    "system",
    label: "System",
    items: [
      {
        id: "appearance", label: "Appearance", icon: Palette,
        description: "Dark / light theme per branch",
        keywords: "theme dark light colour display look",
      },
      {
        id: "security", label: "Security", icon: Shield,
        description: "POS PIN lock and active session management",
        keywords: "pin lock password session logout access",
      },
      {
        id: "connection", label: "Server & Connection", icon: Network,
        description: "View server details and change terminal mode",
        keywords: "network host port client server terminal mode ip",
        roles: ADMIN,
      },
      {
        id: "updates", label: "Updates", icon: Rocket,
        description: "Check for and install app updates",
        keywords: "version upgrade release patch install",
        roles: ADMIN,
      },
    ],
  },
  {
    id:    "data",
    label: "Data & Sync",
    items: [
      {
        id: "cloud-sync", label: "Cloud Sync", icon: Cloud,
        description: "Multi-location real-time sync via Supabase",
        keywords: "supabase replication offline realtime push pull backup cloud",
        roles: ADMIN,
      },
      {
        id: "backup", label: "Backup & Export", icon: Download,
        description: "Database backup, restore, and data export",
        keywords: "dump restore snapshot archive save disaster recovery",
        roles: ADMIN,
      },
      {
        id: "import-export", label: "Import / Export", icon: FileSpreadsheet,
        description: "Excel export folder and import settings",
        keywords: "excel csv xlsx spreadsheet upload download bulk",
      },
    ],
  },
];

/** Flat list of every section, in group order. */
export const SETTINGS_ITEMS = SETTINGS_GROUPS.flatMap((g) => g.items);

/** Look up one section's metadata by its route id. */
export function getSettingsItem(id) {
  return SETTINGS_ITEMS.find((i) => i.id === id);
}

/** True when `roleSlug` may see this section. */
export function canSeeSettingsItem(item, roleSlug) {
  return !item.roles || item.roles.includes(roleSlug);
}

/**
 * Groups filtered by role and by a free-text query, with empty groups dropped.
 * Matching is substring across label + description + keywords so "vat", "thermal"
 * and "escpos" all land on the right section.
 */
export function filterSettingsGroups(query, roleSlug) {
  const q = query.trim().toLowerCase();

  return SETTINGS_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!canSeeSettingsItem(item, roleSlug)) return false;
        if (!q) return true;
        return `${item.label} ${item.description} ${item.keywords ?? ""}`
          .toLowerCase()
          .includes(q);
      }),
    }))
    .filter((group) => group.items.length > 0);
}
