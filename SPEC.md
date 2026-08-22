# SPEC.md — Recovery Agent: Failed-Payment / Subscription Revenue Recovery

**Version:** 1.0
**Status:** Draft — this is the source of truth. If a behavior isn't described here, it doesn't get built until this file is updated first.

---

## 1. Summary

A system that ingests failed recurring-payment events, classifies the root cause of each failure, applies a bounded policy to decide the correct recovery intervention, executes that intervention against Razorpay Test Mode, and records a complete, immutable audit trail. The system reports measured outcomes (recovery rate, amount recovered, unresolved exceptions) over a batch of events.

---

## 2. Goals

- G1. Classify every incoming failed-payment event into a root-cause category using a defined taxonomy (Section 6).
- G2. Select exactly one recovery action per event according to a deterministic policy (Section 7), never by free-form model choice.
- G3. Enforce hard guardrails (retry caps, cooldowns, never-retry categories, opt-out respect) at the code level, independent of any model output.
- G4. Execute the selected action against Razorpay Test Mode APIs.
- G5. Record a complete audit entry per event: input, diagnosis, decision, action, outcome.
- G6. Compute aggregate metrics (recovery rate, amount recovered, per-category breakdown, guardrail-trigger count, unresolved exceptions) over a processed batch.

## 3. Non-Goals

- NG1. Sending real outbound communications (SMS/WhatsApp/email) — messages are generated and logged, not dispatched through a live channel.
- NG2. Handling failure surfaces other than recurring/subscription payment failures (checkout abandonment, B2B receivables are out of scope for this version).
- NG3. Multi-tenant support, authentication, or user management.
- NG4. Any interaction with real-money/live-mode payment processing.

---

## 4. System Overview

```
Event Source ─▶ Classifier ─▶ Policy Engine ─▶ Action Executor ─▶ Audit Log ─▶ Metrics
```

Each stage is a distinct module with a typed input and output (Section 6-9). Stages must be independently testable without requiring the stages before or after them to be live (e.g., the Policy Engine must be fully testable with hand-constructed `Diagnosis` objects, without calling the Classifier or any LLM).

---

## 5. Data Contracts

### 5.1 `RecoveryEvent` (input)

```python
{
  "event_id": str,                     # unique
  "event_type": str,                   # "subscription.charge.failed" | "payment.failed"
  "subscription_id": str | None,
  "payment_id": str,
  "customer_id": str,
  "customer_name": str,
  "amount": int,                        # paise
  "currency": str,                      # "INR"
  "error_code": str,                    # Razorpay top-level error code
  "error_description": str,
  "error_reason": str,                  # Razorpay error.reason value
  "error_source": str,                  # customer | business | internal | gateway | issuer_bank
  "error_step": str,
  "payment_method": str,                # card | upi | netbanking | emandate
  "card_last4": str | None,
  "attempt_number": int,
  "first_failed_at": str,               # ISO 8601
  "event_timestamp": str,               # ISO 8601
  "customer_opted_out": bool
}
```

**Requirement R-1:** `error_code`, `error_reason`, `error_source`, and `error_step` values used anywhere in this system (test data, classification table, code) must match Razorpay's documented values exactly, as published in Razorpay's payment error-codes reference and the Subscriptions webhook payload reference.

**Status:** Verified against Razorpay's official documentation (cards, UPI, and common error-code pages — see `classification_rules.yaml` header for exact source URLs). `error_source` confirmed as `customer | business | internal | gateway | issuer_bank`. Subscriptions webhook payload shape for `error_step` values was not directly available in the same pass and should still be spot-checked against a live Test Mode webhook payload during Day 1 implementation, since Razorpay's docs describe `step` per payment method without a single unified enum listing.

### 5.2 `Diagnosis` (Classifier output)

```python
{
  "event_id": str,
  "root_cause_category": str,           # "soft_decline" | "hard_decline" | "ambiguous"
  "root_cause_label": str,              # matches error_reason or a normalized label
  "confidence": float,                  # 1.0 for deterministic lookup, <1.0 for model-classified
  "classification_method": str,         # "lookup_table" | "llm"
  "reasoning": str,                     # human-readable justification
  "suggested_timing_hint": str | None   # advisory only — does not override Policy Engine windows
}
```

### 5.3 `PolicyDecision` (Policy Engine output)

```python
{
  "event_id": str,
  "action_type": str,                   # "schedule_retry" | "send_nudge" | "escalate" | "no_action"
  "rule_fired": str,                    # identifier of the rule from Section 7 table
  "retry_at": str | None,               # ISO 8601, only if action_type == "schedule_retry"
  "max_attempts_allowed": int,
  "current_attempt": int,
  "guardrail_triggered": str | None,    # identifier from Section 8, if a guardrail fired instead of the base rule
  "explanation": str
}
```

### 5.4 `ActionResult` (Action Executor output)

```python
{
  "event_id": str,
  "action_taken": str,                  # "razorpay_retry_charge" | "message_generated" | "escalated" | "none"
  "api_call_id": str | None,            # Razorpay request/response identifier, if applicable
  "outcome": str,                       # "recovered" | "still_failed" | "message_sent" | "escalated" | "skipped"
  "amount_recovered": int,              # 0 if not recovered
  "executed_at": str,                   # ISO 8601
  "raw_api_response_ref": str | None    # pointer to stored raw response, if applicable
}
```

### 5.5 `AuditLogEntry` (final, append-only)

```python
{
  "event_id": str,
  "event": RecoveryEvent,
  "diagnosis": Diagnosis,
  "policy_decision": PolicyDecision,
  "action_result": ActionResult,
  "pipeline_version": str,
  "logged_at": str
}
```

**Requirement R-2:** Audit log entries are append-only. No entry, once written, may be modified or deleted. Storage format: JSON Lines (one `AuditLogEntry` per line).

---

## 6. Classification Taxonomy

Every event's `error_reason` must resolve to one of three categories. The mapping is stored as a data file (`classification_rules.yaml`), not hardcoded in application logic, so it can be inspected and modified independently of code.

| Category | Definition |
|---|---|
| `soft_decline` | Transient failure; the payment instrument is fundamentally valid; a retry has a reasonable chance of success. |
| `hard_decline` | The instrument itself is invalid, permanently blocked, or the bank has definitively refused it; a retry will not succeed and may carry compliance risk. |
| `ambiguous` | Insufficient information from the deterministic mapping to assign a category with confidence; requires model-based classification. |

**Requirement R-3:** Reason values not present in `classification_rules.yaml` must be routed to the LLM classifier and never silently defaulted to any category.

**Requirement R-4:** The specific `error_reason` string values in the table (e.g., which strings map to `soft_decline` vs `hard_decline`) must be sourced from Razorpay's current documentation per R-1.

**Status:** Satisfied. `classification_rules.yaml` is populated with real `error_reason` values for the `card` and `upi` payment methods, sourced directly from Razorpay's Cards Error Codes and UPI Error Codes documentation, each with a category assignment and rationale. Notably, several real Razorpay reasons (`card_declined`, `payment_failed`, `payment_declined`) are documented by Razorpay itself as carrying no further disclosed detail from the issuing bank — these are assigned `ambiguous` rather than forced into `soft_decline`/`hard_decline`, which validates the three-category taxonomy design rather than a binary one. `netbanking` and `emandate` payment methods referenced in `RecoveryEvent.payment_method` (Section 5.1) are not yet covered in `classification_rules.yaml` and should be added before those payment methods appear in synthetic data or real traffic — track as an open item for Day 1/2.

---

## 7. Policy Rules

Stored as a data file (`policy_rules.yaml`). The Policy Engine is a pure function: `(Diagnosis, event_history) → PolicyDecision`. It must not call any external service and must produce identical output for identical input.

| Rule ID | Condition | Action | Constraint |
|---|---|---|---|
| `SOFT_ATTEMPT_1` | category = soft_decline, attempt = 1 | schedule_retry | timed retry window applies |
| `SOFT_ATTEMPT_2` | category = soft_decline, attempt = 2 | schedule_retry | longer backoff than attempt 1 |
| `SOFT_ATTEMPT_3` | category = soft_decline, attempt = 3 | send_nudge | stop auto-retry |
| `SOFT_EXHAUSTED` | category = soft_decline, attempt ≥ 4 | no_action | log as exhausted; must never re-enter retry path |
| `HARD_DECLINE` | category = hard_decline | send_nudge | never schedule_retry |
| `HARD_DECLINE_SEVERE` | category = hard_decline, root_cause_label in {do_not_honor, stolen_card, restricted_card} | escalate | never retry same instrument, under any condition |
| `AMBIGUOUS_ATTEMPT_1` | category = ambiguous, attempt = 1 | schedule_retry | single attempt only |
| `AMBIGUOUS_ATTEMPT_2` | category = ambiguous, attempt ≥ 2 | escalate | no further automated attempts |
| `OPT_OUT` | customer_opted_out = true | no_action | overrides every other rule, unconditionally |

**Requirement R-5:** Rule evaluation order is: `OPT_OUT` checked first, then guardrails (Section 8), then the base rule table. A guardrail match always overrides a base rule match.

---

## 8. Guardrails (Non-negotiable, enforced in code)

| ID | Rule | Enforcement |
|---|---|---|
| G-1 | Maximum 3 automated retries per subscription/payment instrument, regardless of category or model recommendation. | Hard-coded counter check in Policy Engine. |
| G-2 | Minimum 24-hour cooldown between retry attempts on the same instrument. | Timestamp comparison in Policy Engine. |
| G-3 | `root_cause_label` in {`card_expired`, `invalid_card`, `stolen_card`, `restricted_card`, `do_not_honor`} must never produce `schedule_retry`, irrespective of any classifier or LLM output. | Explicit conditional check, evaluated after classification and before any model-suggested timing is applied. |
| G-4 | `customer_opted_out = true` blocks all actions (retry, message, escalation) except logging. | Checked first in rule evaluation order (R-5). |
| G-5 | If a retry's amount differs from the original event's `amount`, block the action and route to `escalate`. | Equality check in Action Executor prior to API call. |
| G-6 | A global `DRY_RUN` flag, when true, must cause the Action Executor to perform all logic without making a live Razorpay API call, returning a simulated `ActionResult` instead. | Environment/config flag, checked at the top of the Action Executor. |

**Requirement R-6:** G-1 through G-5 must have corresponding automated tests that assert the guardrail fires correctly, independent of the Classifier or any LLM call.

---

## 9. Agent / Model Usage Contract

**Requirement R-7:** The LLM may never directly invoke the Razorpay API or any function that moves money or sends a communication. All LLM output is advisory input consumed by the deterministic Policy Engine and Action Executor.

| Function | Owner | LLM involvement |
|---|---|---|
| Map known `error_reason` → category | Classifier, deterministic lookup | None |
| Classify unmapped/ambiguous `error_reason` | Classifier | LLM call, output is a `Diagnosis` object only |
| Generate reasoning string for audit log | Classifier | LLM call, text output only |
| Suggest retry timing within a policy-defined window | Classifier (advisory) | LLM call; Policy Engine still enforces G-1/G-2 ceilings regardless of suggestion |
| Decide whether/how to act | Policy Engine | None — deterministic only |
| Generate outbound recovery message text | Action Executor (message generation step) | LLM call, text output only, not dispatched (NG1) |
| Execute API call | Action Executor | None — fixed, allowlisted function |

**Requirement R-8:** Tools exposed to the LLM are limited to: `classify_failure`, `generate_recovery_message`, `suggest_retry_timing`. No tool that executes a charge, retry, or refund may be exposed to the model.

---

## 10. Synthetic Test Data

**Requirement R-9:** A batch of 80-120 synthetic `RecoveryEvent` records must be generated for testing, with:
- A fixed random seed for reproducibility.
- A held-out subset (~20%, fixed at generation time) not used during Classifier or Policy Engine development — reserved exclusively for final metric computation.
- Category distribution approximating: 55-60% soft_decline, 25-30% hard_decline, 10-15% ambiguous.
- At least one record with `customer_opted_out = true` (to exercise G-4).
- At least one record with an unmapped `error_reason` (to exercise the ambiguous/LLM path and R-3).
- Variation across `amount`, `attempt_number`, `payment_method`.

---

## 11. Metrics Contract

Computed from `AuditLogEntry` records in the held-out batch only, after a full run:

- **Recovery rate** = count(`outcome = recovered`) / count(`action_type = schedule_retry`).
- **Amount recovered** = sum(`amount_recovered`) across all entries.
- **Per-category breakdown**: recovery rate and count grouped by `root_cause_category`.
- **Guardrail-trigger count**: count of entries where `guardrail_triggered` is not null.
- **Exception list**: all entries where `classification_method = llm` and `confidence < 0.6`, or `outcome = still_failed` after `SOFT_EXHAUSTED`/`AMBIGUOUS_ATTEMPT_2` was reached.

**Requirement R-10:** Reported metrics must be computed only from the held-out subset defined in R-9, not from data used during development/tuning.

---

## 12. Non-Functional Requirements

- NFR-1: Policy Engine and guardrail logic must have zero external dependencies (no network calls) and 100% deterministic output for identical input.
- NFR-2: The full batch pipeline must be runnable end-to-end via a single command, producing `audit_log.jsonl` as output.
- NFR-3: All Razorpay API interactions must default to `DRY_RUN = true` unless explicitly overridden.
- NFR-4: The audit log must be sufficient, on its own, to reconstruct the full reasoning and decision path for any single event without consulting code or external systems.

---

## 13. Acceptance Criteria

- [ ] AC-1: A batch run over the full synthetic dataset (Section 10) completes without manual intervention and produces one `AuditLogEntry` per input event.
- [ ] AC-2: Guardrails G-1 through G-5 each have a passing automated test demonstrating correct behavior.
- [ ] AC-3: At least one event in the dataset triggers a guardrail (verifiable via the `guardrail_triggered` field in the audit log).
- [ ] AC-4: Metrics in Section 11 are computed and reproducible from `audit_log.jsonl` alone.
- [ ] AC-5: `classification_rules.yaml` and `policy_rules.yaml` values are reconciled against real Razorpay documentation (R-1, R-4) — no placeholder values remain.
- [ ] AC-6: No code path allows the LLM to directly trigger a Razorpay API call (verifiable by code review against R-7/R-8).

---

## 14. Implementation Stack

The data contracts in Section 5 and the rule tables in Sections 6-8 are language-neutral by design. This project implements them as follows; this section may be revised independently of the contracts above.

- **Runtime:** Node.js + TypeScript
- **Schema/contract enforcement:** Zod — each object in Section 5 (`RecoveryEvent`, `Diagnosis`, `PolicyDecision`, `ActionResult`, `AuditLogEntry`) is defined as a Zod schema, giving both a TypeScript type and a runtime validator from a single source.
- **Payments:** `razorpay` npm package (official SDK), Test Mode credentials only.
- **LLM:** `@google/generative-ai` (Gemini, free tier, function calling) as primary; `groq-sdk` as a fast fallback. Tool-calling loop hand-rolled rather than a heavy agent framework, per the constrained tool set in Section 9.
- **Rule/config data:** `classification_rules.yaml` and `policy_rules.yaml`, loaded via `js-yaml`. Kept as data files, not TypeScript, so they remain inspectable independent of code (per Section 6-7 intent).
- **Testing:** Vitest, covering Policy Engine and guardrail behavior (R-6) without any network or LLM dependency.
- **Dashboard:** Vite + React, single-page app. Reads `audit_log.json` (an array form of the audit log, written alongside the `.jsonl` file after a batch run) directly via `fetch`; no backend API required since this is a batch report, not a live service.

## 15. Repository Structure

```
recovery-agent/
├── SPEC.md
├── package.json
├── tsconfig.json
├── classification_rules.yaml
├── policy_rules.yaml
├── generate-synthetic-events.ts
├── synthetic_events.json
├── synthetic_events_holdout.json
├── src/
│   ├── schemas.ts              (Zod schemas for Section 5 contracts)
│   ├── classifier.ts
│   ├── policyEngine.ts
│   ├── actionExecutor.ts
│   ├── llmClient.ts             (Gemini primary, Groq fallback)
│   ├── auditLogger.ts
│   ├── metrics.ts
│   └── runBatch.ts              (entry point, produces audit_log.jsonl + audit_log.json)
├── tests/
│   ├── policyEngine.test.ts
│   ├── guardrails.test.ts
│   └── classifier.test.ts
├── dashboard/                    (Vite + React app)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   └── main.tsx
│   ├── public/
│   │   └── audit_log.json       (copied here after each batch run)
│   ├── index.html
│   └── vite.config.ts
├── audit_log.jsonl
└── audit_log.json
```
