/**
 * generate-synthetic-events.ts — Synthetic test data generator.
 *
 * Produces 80-120 RecoveryEvent records with:
 *   - Fixed random seed for reproducibility
 *   - ~20% held-out subset (written to synthetic_events_holdout.json)
 *   - Category distribution: 55-60% soft, 25-30% hard, 10-15% ambiguous
 *   - At least 1 customer_opted_out=true record
 *   - At least 1 unmapped error_reason record
 *   - Variation across amount, attempt_number, payment_method
 *
 * Satisfies: R-9
 * Implementation: Day 2 (T2.1)
 */

// TODO: T2.1 — implement synthetic event generation
