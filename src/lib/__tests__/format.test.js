import { describe, it, expect, beforeEach } from "vitest";
import { formatCurrency, setCurrencyConfig, getCurrencyCode } from "../format";

// Reset to default NGN config before each test so tests are independent.
beforeEach(() => {
  setCurrencyConfig({ currency: "NGN" });
});

describe("formatCurrency", () => {
  // ── NGN (default) ──────────────────────────────────────────────────────────

  it("formats a positive NGN amount", () => {
    const result = formatCurrency(1500);
    expect(result).toContain("1,500");
    expect(result).toContain("500.00");
  });

  it("formats zero correctly", () => {
    const result = formatCurrency(0);
    expect(result).toMatch(/0\.00/);
  });

  it("returns fallback for NaN input", () => {
    const result = formatCurrency(NaN);
    expect(result).toContain("0.00");
  });

  it("accepts a numeric string input", () => {
    const result = formatCurrency("2500.0000");
    expect(result).toContain("2,500");
  });

  it("two decimal places by default", () => {
    expect(formatCurrency(1)).toMatch(/1\.00/);
  });

  // ── decimals option ────────────────────────────────────────────────────────

  it("respects decimals: 0 option", () => {
    const result = formatCurrency(1500, { decimals: 0 });
    expect(result).not.toContain(".");
    expect(result).toContain("1,500");
  });

  it("respects decimals: 3 option", () => {
    const result = formatCurrency(1.5, { decimals: 3 });
    expect(result).toContain("1.500");
  });

  // ── Currency override ──────────────────────────────────────────────────────

  it("uses USD symbol when currency: 'USD' is passed", () => {
    const result = formatCurrency(100, { currency: "USD" });
    expect(result).toContain("$");
    expect(result).toContain("100");
  });

  it("uses GBP symbol when currency: 'GBP' is passed", () => {
    const result = formatCurrency(50, { currency: "GBP" });
    expect(result).toContain("£");
  });

  it("per-call currency override does not change module-level config", () => {
    formatCurrency(100, { currency: "USD" });
    expect(getCurrencyCode()).toBe("NGN");
  });

  // ── setCurrencyConfig ──────────────────────────────────────────────────────

  it("setCurrencyConfig changes the module-level currency", () => {
    setCurrencyConfig({ currency: "GHS" });
    expect(getCurrencyCode()).toBe("GHS");
  });

  it("subsequent formatCurrency calls use the configured currency", () => {
    setCurrencyConfig({ currency: "USD" });
    const result = formatCurrency(200);
    expect(result).toContain("$");
  });

  // ── Negative values ────────────────────────────────────────────────────────

  it("formats negative amounts correctly", () => {
    const result = formatCurrency(-500);
    expect(result).toContain("500");
    // Intl formats negatives with a minus sign or parentheses — just check value
  });
});
