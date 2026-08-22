import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "../src/policyEngine";
import { Diagnosis, RecoveryEvent } from "../src/schemas";

function createDummyEvent(overrides: Partial<RecoveryEvent> = {}): RecoveryEvent {
  return {
    event_id: "evt_123",
    event_type: "subscription.charge.failed",
    subscription_id: "sub_123",
    payment_id: "pay_123",
    customer_id: "cust_123",
    customer_name: "Test Customer",
    amount: 10000,
    currency: "INR",
    error_code: "BAD_REQUEST_ERROR",
    error_description: "Failed",
    error_reason: "insufficient_funds",
    error_source: "issuer_bank",
    error_step: "payment_authorization",
    payment_method: "card",
    card_last4: "1234",
    attempt_number: 1,
    first_failed_at: new Date().toISOString(),
    event_timestamp: new Date().toISOString(),
    customer_opted_out: false,
    ...overrides
  };
}

function createDummyDiagnosis(overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    event_id: "evt_123",
    root_cause_category: "soft_decline",
    root_cause_label: "insufficient_funds",
    confidence: 1.0,
    classification_method: "lookup_table",
    reasoning: "Test reasoning",
    suggested_timing_hint: null,
    ...overrides
  };
}

describe("Policy Engine", () => {
  it("SOFT_ATTEMPT_1: soft_decline, attempt 1 -> schedule_retry, 24h", () => {
    const event = createDummyEvent({ attempt_number: 1 });
    const diagnosis = createDummyDiagnosis({ root_cause_category: "soft_decline" });
    const decision = evaluatePolicy(diagnosis, event);
    expect(decision.rule_fired).toBe("SOFT_ATTEMPT_1");
    expect(decision.action_type).toBe("schedule_retry");
  });

  it("SOFT_ATTEMPT_2: soft_decline, attempt 2 -> schedule_retry, 48h", () => {
    const event = createDummyEvent({ attempt_number: 2 });
    const diagnosis = createDummyDiagnosis({ root_cause_category: "soft_decline" });
    const decision = evaluatePolicy(diagnosis, event);
    expect(decision.rule_fired).toBe("SOFT_ATTEMPT_2");
    expect(decision.action_type).toBe("schedule_retry");
  });

  it("SOFT_ATTEMPT_3: soft_decline, attempt 3 -> send_nudge", () => {
    const event = createDummyEvent({ attempt_number: 3 });
    const diagnosis = createDummyDiagnosis({ root_cause_category: "soft_decline" });
    const decision = evaluatePolicy(diagnosis, event);
    expect(decision.rule_fired).toBe("SOFT_ATTEMPT_3");
    expect(decision.action_type).toBe("send_nudge");
  });

  it("SOFT_EXHAUSTED: soft_decline, attempt >= 4 -> no_action", () => {
    const event = createDummyEvent({ attempt_number: 4 });
    const diagnosis = createDummyDiagnosis({ root_cause_category: "soft_decline" });
    const decision = evaluatePolicy(diagnosis, event);
    expect(decision.rule_fired).toBe("SOFT_EXHAUSTED");
    expect(decision.action_type).toBe("no_action");
  });

  it("HARD_DECLINE: hard_decline -> send_nudge", () => {
    const event = createDummyEvent({ attempt_number: 1 });
    const diagnosis = createDummyDiagnosis({ root_cause_category: "hard_decline", root_cause_label: "card_not_enrolled" });
    const decision = evaluatePolicy(diagnosis, event);
    expect(decision.rule_fired).toBe("HARD_DECLINE");
    expect(decision.action_type).toBe("send_nudge");
  });

  it("HARD_DECLINE_SEVERE: hard_decline, stolen_card -> escalate", () => {
    const event = createDummyEvent({ attempt_number: 1 });
    const diagnosis = createDummyDiagnosis({ root_cause_category: "hard_decline", root_cause_label: "stolen_card" });
    const decision = evaluatePolicy(diagnosis, event);
    expect(decision.rule_fired).toBe("HARD_DECLINE_SEVERE");
    expect(decision.action_type).toBe("escalate");
  });

  it("AMBIGUOUS_ATTEMPT_1: ambiguous, attempt 1 -> schedule_retry", () => {
    const event = createDummyEvent({ attempt_number: 1 });
    const diagnosis = createDummyDiagnosis({ root_cause_category: "ambiguous" });
    const decision = evaluatePolicy(diagnosis, event);
    expect(decision.rule_fired).toBe("AMBIGUOUS_ATTEMPT_1");
    expect(decision.action_type).toBe("schedule_retry");
  });

  it("AMBIGUOUS_ATTEMPT_2: ambiguous, attempt >= 2 -> escalate", () => {
    const event = createDummyEvent({ attempt_number: 2 });
    const diagnosis = createDummyDiagnosis({ root_cause_category: "ambiguous" });
    const decision = evaluatePolicy(diagnosis, event);
    expect(decision.rule_fired).toBe("AMBIGUOUS_ATTEMPT_2");
    expect(decision.action_type).toBe("escalate");
  });

  it("OPT_OUT: overrides all other rules", () => {
    const event = createDummyEvent({ attempt_number: 1, customer_opted_out: true });
    // Should be soft_decline attempt 1, but opt_out overrides
    const diagnosis = createDummyDiagnosis({ root_cause_category: "soft_decline" });
    const decision = evaluatePolicy(diagnosis, event);
    expect(decision.rule_fired).toBe("OPT_OUT");
    expect(decision.action_type).toBe("no_action");
  });
});
