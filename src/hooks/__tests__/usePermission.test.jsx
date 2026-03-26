import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAuthStore } from "@/stores/auth.store";
import { usePermission, usePermissions, useAnyPermission } from "../usePermission";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setUser(overrides = {}) {
  useAuthStore.setState({
    user: {
      id: 1,
      username: "testuser",
      role_id: 2,
      role_slug: "cashier",
      is_global: false,
      permissions: ["transactions.create", "transactions.view", "items.view"],
      ...overrides,
    },
  });
}

function clearUser() {
  useAuthStore.setState({ user: null });
}

// Reset store before each test
beforeEach(() => {
  clearUser();
});

// ── usePermission ─────────────────────────────────────────────────────────────

describe("usePermission", () => {
  it("returns false when no user is logged in", () => {
    const { result } = renderHook(() => usePermission("transactions.create"));
    expect(result.current).toBe(false);
  });

  it("returns true for a slug the user has", () => {
    setUser();
    const { result } = renderHook(() => usePermission("transactions.create"));
    expect(result.current).toBe(true);
  });

  it("returns false for a slug the user does not have", () => {
    setUser();
    const { result } = renderHook(() => usePermission("users.delete"));
    expect(result.current).toBe(false);
  });

  it("returns true for any slug when user is global (super_admin)", () => {
    setUser({ is_global: true, permissions: [] });
    const { result } = renderHook(() => usePermission("users.delete"));
    expect(result.current).toBe(true);
  });

  it("returns false when user has empty permissions array", () => {
    setUser({ permissions: [] });
    const { result } = renderHook(() => usePermission("transactions.create"));
    expect(result.current).toBe(false);
  });

  it("returns false when user permissions is undefined", () => {
    setUser({ permissions: undefined });
    const { result } = renderHook(() => usePermission("transactions.create"));
    expect(result.current).toBe(false);
  });
});

// ── usePermissions (must have ALL) ────────────────────────────────────────────

describe("usePermissions", () => {
  it("returns true when user has all requested slugs", () => {
    setUser();
    const { result } = renderHook(() =>
      usePermissions(["transactions.create", "transactions.view"])
    );
    expect(result.current).toBe(true);
  });

  it("returns false when user is missing one of the slugs", () => {
    setUser();
    const { result } = renderHook(() =>
      usePermissions(["transactions.create", "users.delete"])
    );
    expect(result.current).toBe(false);
  });

  it("returns true for empty slug list", () => {
    setUser();
    const { result } = renderHook(() => usePermissions([]));
    // every() on empty array is vacuously true
    expect(result.current).toBe(true);
  });

  it("global user always returns true", () => {
    setUser({ is_global: true, permissions: [] });
    const { result } = renderHook(() =>
      usePermissions(["users.delete", "stores.delete"])
    );
    expect(result.current).toBe(true);
  });
});

// ── useAnyPermission (must have AT LEAST ONE) ─────────────────────────────────

describe("useAnyPermission", () => {
  it("returns true when user has at least one slug", () => {
    setUser();
    const { result } = renderHook(() =>
      useAnyPermission(["users.delete", "transactions.create"])
    );
    expect(result.current).toBe(true);
  });

  it("returns false when user has none of the slugs", () => {
    setUser();
    const { result } = renderHook(() =>
      useAnyPermission(["users.delete", "stores.delete"])
    );
    expect(result.current).toBe(false);
  });

  it("global user always returns true", () => {
    setUser({ is_global: true, permissions: [] });
    const { result } = renderHook(() =>
      useAnyPermission(["users.delete"])
    );
    expect(result.current).toBe(true);
  });

  it("returns false for empty slug list with no permissions", () => {
    setUser({ permissions: [] });
    const { result } = renderHook(() => useAnyPermission([]));
    // some() on empty array is false
    expect(result.current).toBe(false);
  });
});
