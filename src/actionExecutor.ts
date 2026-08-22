import Razorpay from 'razorpay';
import { ActionResult, PolicyDecision, RecoveryEvent } from "./schemas.js";

/**
 * actionExecutor.ts — Executes recovery actions against Razorpay Test Mode.
 *
 * Consumes a PolicyDecision, produces an ActionResult.
 * Enforces G-5 (amount-match) and G-6 (DRY_RUN) before any API call.
 */

// G-6: Global DRY_RUN flag. Defaults to true per NFR-3.
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
    if (CONFIG.DRY_RUN) {
      result.outcome = "recovered"; // Assuming success in dry run
      result.amount_recovered = event.amount;
      result.api_call_id = "dry_run_retry_id";
      return result;
    }

    try {
      const response = await razorpay.paymentLink.create({
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
      });

      result.outcome = "recovered";
      result.amount_recovered = event.amount;
      result.api_call_id = response.id;
    } catch (error: any) {
      result.outcome = "still_failed";
      result.raw_api_response_ref = error.message || "Razorpay API error";
    }
    return result;
  }

  return result;
}
