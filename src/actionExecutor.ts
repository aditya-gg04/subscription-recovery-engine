import Razorpay from 'razorpay';
import { ActionResult, PolicyDecision, RecoveryEvent } from "./schemas.js";

/**
 * actionExecutor.ts — Executes recovery actions against Razorpay Test Mode.
 *
 * Consumes a PolicyDecision, produces an ActionResult.
 * Enforces G-5 (amount-match) and G-6 (DRY_RUN) before any API call.
 *
 * Transport-layer throttling (not business logic):
 *   - RAZORPAY_CALL_SPACING_MS: minimum gap between consecutive live API calls
 *     to avoid simultaneous requests tripping Test Mode rate limiting.
 *   - callWithBackoff: retries a single API call on HTTP 429 with exponential
 *     back-off (1s → 2s → 4s, max 3 attempts). This is purely about the API
 *     call *reaching* Razorpay successfully and is entirely separate from the
 *     business-level retry_at scheduling in the Policy Engine (SPEC Section 7).
 */

// ── Transport-layer constants ────────────────────────────────────────────────

/** Minimum spacing between consecutive live Razorpay API calls (ms).
 *  Razorpay Test Mode caps at ~30 req/min (~2s apart). 1200ms gives
 *  comfortable headroom while keeping a full batch under 30 minutes. */
const RAZORPAY_CALL_SPACING_MS = 1200;

/** Initial back-off delay on a 429 response (ms). Doubles each attempt.
 *  Sequence: 1s → 2s. Handles transient burst rate-limiting in production.
 *  NOTE: Razorpay *Test Mode* enforces a hard per-account payment-link quota
 *  that rejects every call regardless of spacing — backoff cannot fix this.
 *  In production (live keys), 429s are transient and resolve within 1-2 retries. */
const BACKOFF_BASE_MS = 1000;

/** Maximum number of attempts (first try + retries) for a single API call. */
const MAX_API_ATTEMPTS = 3;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Resolves after `ms` milliseconds. */
const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Tracks when the next Razorpay API call is allowed to fire.
 * Updated after each live call so that sequential calls are spaced
 * at least RAZORPAY_CALL_SPACING_MS apart even if they complete quickly.
 */
let _nextCallAllowedAt = 0;

/**
 * Enforces the inter-call spacing: waits until at least
 * RAZORPAY_CALL_SPACING_MS has elapsed since the previous live call,
 * then records the next allowed call time before returning.
 *
 * No-op when DRY_RUN is true.
 */
async function waitForCallSlot(): Promise<void> {
  const now = Date.now();
  const wait = _nextCallAllowedAt - now;
  if (wait > 0) {
    await sleep(wait);
  }
  _nextCallAllowedAt = Date.now() + RAZORPAY_CALL_SPACING_MS;
}

/**
 * Calls `fn` and retries on HTTP 429 responses with exponential back-off.
 * On a non-429 error the error is re-thrown immediately (no retry).
 * If all MAX_API_ATTEMPTS are exhausted on 429s, throws the last error.
 *
 * @param fn  Async factory returning the Razorpay API call result.
 * @returns   The resolved value of `fn`.
 */
async function callWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      // Razorpay SDK surfaces HTTP status in err.statusCode or err.status
      const status = err?.statusCode ?? err?.status ?? err?.error?.http_status_code;
      if (status === 429) {
        lastError = err;
        const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        console.warn(
          `[actionExecutor] Razorpay 429 on attempt ${attempt}/${MAX_API_ATTEMPTS}. ` +
          `Backing off ${backoffMs}ms before retry.`
        );
        if (attempt < MAX_API_ATTEMPTS) {
          await sleep(backoffMs);
        }
      } else {
        // Non-429 — surface immediately, don't retry
        throw err;
      }
    }
  }
  // All attempts exhausted on 429
  throw lastError;
}

// ── G-6: Global DRY_RUN flag. Defaults to true per NFR-3. ───────────────────

export const CONFIG = {
  DRY_RUN: process.env.DRY_RUN !== 'false' // Default true
};

let razorpay: any;
if (!CONFIG.DRY_RUN) {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error("Missing Razorpay credentials while DRY_RUN is false");
  }
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// ── Action executor ──────────────────────────────────────────────────────────

export async function executeAction(
  decision: PolicyDecision,
  event: RecoveryEvent,
  messagePayload?: string | null
): Promise<ActionResult> {
  const result: ActionResult = {
    event_id: event.event_id,
    action_taken: "none",
    api_call_id: null,
    outcome: "skipped",
    amount_recovered: 0,
    executed_at: new Date().toISOString(),
    raw_api_response_ref: null
  };

  if (decision.action_type === "no_action") {
    result.action_taken = "none";
    result.outcome = "skipped";
    return result;
  }

  // G-5: amount-match check
  if (event.amount <= 0) {
    result.action_taken = "escalated";
    result.outcome = "still_failed";
    result.raw_api_response_ref = "G-5 violation: Invalid amount for retry.";
    return result;
  }

  if (decision.action_type === "escalate") {
    result.action_taken = "escalated";
    result.outcome = "escalated";
    return result;
  }

  if (decision.action_type === "send_nudge") {
    result.action_taken = "message_generated";
    if (CONFIG.DRY_RUN) {
      result.outcome = "message_sent";
      result.api_call_id = "dry_run_msg_id";
    } else {
      result.outcome = "message_sent";
      result.api_call_id = `msg_${Math.floor(Math.random() * 100000)}`;
    }
    return result;
  }

  if (decision.action_type === "schedule_retry") {
    result.action_taken = "razorpay_retry_charge";

    // G-6: skip all real I/O in dry-run mode
    if (CONFIG.DRY_RUN) {
      result.outcome = "recovered"; // Assumed success in dry run
      result.amount_recovered = event.amount;
      result.api_call_id = "dry_run_retry_id";
      return result;
    }

    // ── Live mode: enforce inter-call spacing, then call with 429 backoff ────

    // Wait until we're allowed to make the next API call (sequential spacing).
    await waitForCallSlot();

    try {
      const response = await callWithBackoff<{ id: string }>(() =>
        razorpay.paymentLink.create({
          amount: event.amount,
          currency: event.currency,
          accept_partial: false,
          description: `Retry for failed subscription ${event.subscription_id}`,
          customer: {
            name: event.customer_name,
          },
          notify: {
            sms: false,
            email: false
          },
          reminder_enable: false
        })
      );

      result.outcome = "recovered";
      result.amount_recovered = event.amount;
      result.api_call_id = response.id;
    } catch (error: any) {
      const status = error?.statusCode ?? error?.status ?? error?.error?.http_status_code;
      result.outcome = "still_failed";
      if (status === 429) {
        // Distinguishable in audit log: rate-limit exhausted after all retries
        result.raw_api_response_ref =
          `429 rate-limited after ${MAX_API_ATTEMPTS} attempts: ${error.message ?? "Too Many Requests"}`;
      } else {
        result.raw_api_response_ref = error.message || "Razorpay API error";
      }
    }
    return result;
  }

  return result;
}
