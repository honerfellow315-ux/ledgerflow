import { z } from "zod";

/**
 * Shared numeric bounds for server-side validation. They only reject values
 * that can never be real (NaN/Infinity, absurd magnitudes, a VAT rate over
 * 100%) — normal amounts, including credits/negatives, pass through untouched
 * so no calculation changes.
 */
export const money = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
export const vatPercent = z.number().finite().min(0).max(100);
export const hoursAmount = z.number().finite().min(0).max(1_000_000);
export const smallNumber = z.number().finite().min(-1_000_000).max(1_000_000);
