import { expect, test } from "vitest";
import { formatDate, formatNumber, LOCALE } from "@/shared/lib/format";

test("formats numbers in en-US", () => {
  expect(LOCALE).toBe("en-US");
  expect(formatNumber(1234.5)).toBe("1,234.5");
});

test("applies number format options", () => {
  expect(formatNumber(1234.5, { minimumFractionDigits: 2 })).toBe("1,234.50");
});

test("formats a calendar day in UTC", () => {
  expect(formatDate("2026-11-05")).toBe("Nov 5, 2026");
});
