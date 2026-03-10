// ============================================================================
// stores/ui.store.js — Global UI state
// ============================================================================
// Manages sidebar state, active modals, and notification queue.
// Components read this store to coordinate UI — no business logic here.
//
// Usage:
//   const { openModal, closeModal, activeModal } = useUiStore()
//   openModal("confirm-void")   → sets  activeModal = "confirm-void"
//   closeModal()                → sets activeModal = null
// ============================================================================

import { create } from "zustand";

export const useUiStore = create((set, get) => ({
  // ── Sidebar ───────────────────────────────────────────────────────────────
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  // ── Modal coordination ────────────────────────────────────────────────────
  // Use string names so any component can check what's open without importing
  // the modal component itself.
  activeModal: null, // string | null
  modalData: null, // arbitrary payload passed to the modal

  openModal: (name, data = null) => set({ activeModal: name, modalData: data }),
  closeModal: () => set({ activeModal: null, modalData: null }),
  isModalOpen: (name) => get().activeModal === name,

  // ── Sheet / drawer coordination ───────────────────────────────────────────
  activeSheet: null, // string | null
  sheetData: null,

  openSheet: (name, data = null) => set({ activeSheet: name, sheetData: data }),
  closeSheet: () => set({ activeSheet: null, sheetData: null }),
  isSheetOpen: (name) => get().activeSheet === name,

  // ── Command palette / search overlay ─────────────────────────────────────
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
}));
