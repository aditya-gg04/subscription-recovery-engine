import { Diagnosis, PolicyDecision, RecoveryEvent } from './schemas.js';

/**
 * policyEngine.ts — Deterministic policy engine.
 * Pure function: (Diagnosis, event_history) → PolicyDecision
 *
 * Evaluation order (R-5):
 *   1. OPT_OUT (G-4)
 *   2. Guardrails G-1 through G-5
 *   3. Base rules from policy_rules.yaml
 */

const SEVERE_HARD_DECLINES = [
  'card_expired', 'invalid_card', 'stolen_card', 'restricted_card', 'do_not_honor'
];

export function evaluatePolicy(diagnosis: Diagnosis, event: RecoveryEvent): PolicyDecision {
  // G-4 / OPT_OUT
  if (event.customer_opted_out) {
    return {
      event_id: event.event_id,
      action_type: "no_action",
      rule_fired: "OPT_OUT",
      retry_at: null,
      max_attempts_allowed: 3,
      current_attempt: event.attempt_number,
      guardrail_triggered: "G-4",
      explanation: "Customer has opted out of recovery communications."
    };
  }

  // G-3 / HARD_DECLINE_SEVERE check
  if (diagnosis.root_cause_category === "hard_decline" && SEVERE_HARD_DECLINES.includes(diagnosis.root_cause_label)) {
    return {
      event_id: event.event_id,
      action_type: "escalate",
      rule_fired: "HARD_DECLINE_SEVERE",
      retry_at: null,
      max_attempts_allowed: 0,
      current_attempt: event.attempt_number,
      guardrail_triggered: "G-3",
      explanation: "Severe hard decline reason requires immediate escalation."
    };
  }

  // Base rules evaluation
  if (diagnosis.root_cause_category === "soft_decline") {
    if (event.attempt_number === 1) {
      return {
        event_id: event.event_id,
        action_type: "schedule_retry",
        rule_fired: "SOFT_ATTEMPT_1",
        retry_at: calculateRetryTime(event.event_timestamp, 24), // G-2 floor
        max_attempts_allowed: 3,
        current_attempt: event.attempt_number,
        guardrail_triggered: null,
        explanation: "First soft decline attempt, scheduling retry."
      };
    } else if (event.attempt_number === 2) {
      return {
        event_id: event.event_id,
        action_type: "schedule_retry",
        rule_fired: "SOFT_ATTEMPT_2",
        retry_at: calculateRetryTime(event.event_timestamp, 48), // G-2 floor
        max_attempts_allowed: 3,
        current_attempt: event.attempt_number,
        guardrail_triggered: null,
        explanation: "Second soft decline attempt, scheduling retry with backoff."
      };
    } else if (event.attempt_number === 3) {
      return {
        event_id: event.event_id,
        action_type: "send_nudge",
        rule_fired: "SOFT_ATTEMPT_3",
        retry_at: null,
        max_attempts_allowed: 3,
        current_attempt: event.attempt_number,
        guardrail_triggered: null,
        explanation: "Third soft decline attempt, sending customer nudge."
      };
    } else {
      // attempt >= 4
      return {
        event_id: event.event_id,
        action_type: "no_action",
        rule_fired: "SOFT_EXHAUSTED",
        retry_at: null,
        max_attempts_allowed: 3,
        current_attempt: event.attempt_number,
        guardrail_triggered: "G-1",
        explanation: "Max retry attempts exhausted."
      };
    }
  }

  if (diagnosis.root_cause_category === "hard_decline") {
    // Non-severe hard decline
    return {
      event_id: event.event_id,
      action_type: "send_nudge",
      rule_fired: "HARD_DECLINE",
      retry_at: null,
      max_attempts_allowed: 0,
      current_attempt: event.attempt_number,
      guardrail_triggered: null,
      explanation: "Hard decline requires customer to update payment method."
    };
  }

  if (diagnosis.root_cause_category === "ambiguous") {
    if (event.attempt_number === 1) {
      return {
        event_id: event.event_id,
        action_type: "schedule_retry",
        rule_fired: "AMBIGUOUS_ATTEMPT_1",
        retry_at: calculateRetryTime(event.event_timestamp, 24), // G-2 floor
        max_attempts_allowed: 1,
        current_attempt: event.attempt_number,
        guardrail_triggered: null,
        explanation: "First ambiguous attempt, scheduling retry."
      };
    } else {
      // attempt >= 2
      return {
        event_id: event.event_id,
        action_type: "escalate",
        rule_fired: "AMBIGUOUS_ATTEMPT_2",
        retry_at: null,
        max_attempts_allowed: 1,
        current_attempt: event.attempt_number,
        guardrail_triggered: "G-1",
        explanation: "Max ambiguous attempts exhausted, escalating."
      };
    }
  }

  // Fallback
  return {
    event_id: event.event_id,
    action_type: "no_action",
    rule_fired: "UNKNOWN",
    retry_at: null,
    max_attempts_allowed: 0,
    current_attempt: event.attempt_number,
    guardrail_triggered: null,
    explanation: "Unknown category."
  };
}

function calculateRetryTime(eventTimestamp: string, delayHours: number): string {
  const date = new Date(eventTimestamp);
  date.setHours(date.getHours() + delayHours);
  return date.toISOString();
}
