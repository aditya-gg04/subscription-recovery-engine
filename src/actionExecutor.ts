import { ActionResult, PolicyDecision, RecoveryEvent } from "./schemas";

/**
 * actionExecutor.ts — Executes recovery actions against Razorpay Test Mode.
 *
 * Consumes a PolicyDecision, produces an ActionResult.
 * Enforces G-5 (amount-match) and G-6 (DRY_RUN) before any API call.
 */

// G-6: Global DRY_RUN flag. Defaults to true per NFR-3.
export const CONFIG = {
  DRY_RUN: process.env.DRY_RUN !== 'false' // NFR-3: defaults to true unless explicitly overridden
};

export async function executeAction(
  decision: PolicyDecision,
  event: RecoveryEvent
): Promise<ActionResult> {
  // TODO: T5.1/T5.2 implementation
  throw new Error("Not implemented");
}
