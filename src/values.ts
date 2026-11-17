import type { FeatureValue } from "./types.js";

/** The largest number value the API accepts (2^53-1, exact in JavaScript). */
export const MAX_NUMBER = Number.MAX_SAFE_INTEGER;

/** The value of an unlimited number feature. */
export const UNLIMITED = "unlimited" as const;

/** A number feature's limit: a whole number, or unlimited. */
export type Limit = { unlimited: false; n: number } | { unlimited: true };

/**
 * Reads a number feature's value. Returns undefined for booleans, enum
 * options and null. This is a decoding helper, not an entitlement decision.
 */
export function limit(value: FeatureValue | null | undefined): Limit | undefined {
  if (value === UNLIMITED) return { unlimited: true };
  if (typeof value === "number") return { unlimited: false, n: value };
  return undefined;
}

/** Reports whether a value is the unlimited marker. */
export function isUnlimited(value: FeatureValue | null | undefined): boolean {
  return value === UNLIMITED;
}
