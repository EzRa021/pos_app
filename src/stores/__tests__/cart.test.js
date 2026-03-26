import { describe, it, expect } from "vitest";
import { calcCartTotals } from "../cart.store";

// Helper to build a minimal cart item
function item(price, quantity, taxRate = 0, discount = 0) {
  return { price, quantity, taxRate, discount };
}

describe("calcCartTotals", () => {
  // ── Basic totals ───────────────────────────────────────────────────────────

  it("returns all-zero totals for an empty cart", () => {
    const { subtotal, tax, discountAmt, total } = calcCartTotals([]);
    expect(subtotal).toBe(0);
    expect(tax).toBe(0);
    expect(discountAmt).toBe(0);
    expect(total).toBe(0);
  });

  it("single item, no tax, no discount", () => {
    const { subtotal, total, tax, discountAmt } = calcCartTotals([item(100, 2)]);
    expect(subtotal).toBe(200);
    expect(total).toBe(200);
    expect(tax).toBe(0);
    expect(discountAmt).toBe(0);
  });

  it("multiple items sum correctly", () => {
    const { subtotal } = calcCartTotals([item(50, 3), item(100, 1)]);
    expect(subtotal).toBe(250);
  });

  // ── VAT extraction (inclusive pricing) ────────────────────────────────────

  it("extracts 7.5% VAT from inclusive price — does NOT add it on top", () => {
    // ₦107.50 at 7.5% VAT inclusive → tax = 107.50 × 7.5 / 107.5 = 7.5
    const { subtotal, tax, total } = calcCartTotals([item(107.5, 1, 7.5)]);
    expect(subtotal).toBe(107.5);
    expect(total).toBe(107.5);       // total must NOT be 107.5 + 7.5
    expect(tax).toBeCloseTo(7.5, 4);
  });

  it("tax is zero for zero-rate items", () => {
    const { tax } = calcCartTotals([item(500, 1, 0)]);
    expect(tax).toBe(0);
  });

  it("sums tax across mixed-rate lines", () => {
    // line1: ₦107.50, rate 7.5% → tax ≈ 7.50
    // line2: ₦200, rate 0%     → tax = 0
    const { tax } = calcCartTotals([item(107.5, 1, 7.5), item(200, 1, 0)]);
    expect(tax).toBeCloseTo(7.5, 4);
  });

  // ── Per-line discount ──────────────────────────────────────────────────────

  it("per-line discount reduces subtotal and total", () => {
    const { subtotal, total } = calcCartTotals([item(100, 2, 0, 20)]);
    expect(subtotal).toBe(180); // 200 − 20
    expect(total).toBe(180);
  });

  // ── Cart-level flat discount ───────────────────────────────────────────────

  it("flat cart discount is subtracted from total", () => {
    const { total, discountAmt } = calcCartTotals([item(200, 1)], 30, 0);
    expect(discountAmt).toBe(30);
    expect(total).toBe(170);
  });

  it("total cannot go below zero when flat discount exceeds subtotal", () => {
    const { total } = calcCartTotals([item(50, 1)], 100, 0);
    expect(total).toBe(0);
  });

  // ── Cart-level percentage discount ────────────────────────────────────────

  it("percentage discount takes priority over flat discount", () => {
    // 10% of ₦200 = ₦20 discount; the ₦999 flat amount must be ignored
    const { discountAmt, total } = calcCartTotals([item(200, 1)], 999, 10);
    expect(discountAmt).toBeCloseTo(20, 5);
    expect(total).toBeCloseTo(180, 5);
  });

  it("100% discount results in zero total", () => {
    const { total } = calcCartTotals([item(500, 2)], 0, 100);
    expect(total).toBe(0);
  });

  // ── Financial precision ────────────────────────────────────────────────────

  it("handles fractional prices without floating-point blow-up", () => {
    // 3 × ₦33.33 = 99.99 — check no rounding surprises
    const { subtotal } = calcCartTotals([item(33.33, 3)]);
    expect(subtotal).toBeCloseTo(99.99, 5);
  });
});
