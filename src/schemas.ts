/**
 * schemas.ts — Zod schemas for all data contracts defined in SPEC.md Section 5.
 *
 * Each schema serves as both a TypeScript type (via z.infer) and a runtime
 * validator. This is the single source of truth for the shape of data flowing
 * through the pipeline.
 *
 * Satisfies: SPEC Section 5 (all subsections), R-1 (enum values match Razorpay docs).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 5.1 RecoveryEvent (input)
// ---------------------------------------------------------------------------

export const RecoveryEventSchema = z.object({
  /** Unique event identifier */
  event_id: z.string(),

  /** "subscription.charge.failed" | "payment.failed" */
  event_type: z.enum(["subscription.charge.failed", "payment.failed"]),

  /** Subscription ID, null for standalone payment failures */
  subscription_id: z.string().nullable(),

  /** Razorpay payment ID */
  payment_id: z.string(),

  /** Razorpay customer ID */
  customer_id: z.string(),

  /** Customer display name */
  customer_name: z.string(),

  /** Amount in paise */
  amount: z.number().int().nonnegative(),

  /** Currency code */
  currency: z.string(),

  /** Razorpay top-level error code */
  error_code: z.string(),

  /** Human-readable error description */
  error_description: z.string(),

  /** Razorpay error.reason value — key for classification lookup */
  error_reason: z.string(),

  /**
   * Razorpay error source.
   * Confirmed enum per Razorpay Cards Error Codes docs:
   *   customer | business | internal | gateway | issuer_bank
   */
  error_source: z.enum([
    "customer",
    "business",
    "internal",
    "gateway",
    "issuer_bank",
  ]),

  /**
   * Razorpay error step value.
   * Defined as free string — Razorpay docs describe step per payment method
   * without a single unified enum listing. (Decision: agreed with user.)
   */
  error_step: z.string(),

  /** Payment method */
  payment_method: z.enum(["card", "upi", "netbanking", "emandate"]),

  /** Last 4 digits of card, null for non-card methods */
  card_last4: z.string().length(4).nullable(),

  /** 1-indexed attempt count for this subscription/instrument */
  attempt_number: z.number().int().positive(),

  /** ISO 8601 timestamp of the first failure in this retry sequence */
  first_failed_at: z.string().datetime(),

  /** ISO 8601 timestamp of this specific event */
  event_timestamp: z.string().datetime(),

  /** Whether the customer has opted out of recovery communications */
  customer_opted_out: z.boolean(),
});

export type RecoveryEvent = z.infer<typeof RecoveryEventSchema>;

// ---------------------------------------------------------------------------
// 5.2 Diagnosis (Classifier output)
// ---------------------------------------------------------------------------

/** Root-cause category taxonomy — SPEC Section 6 */
export const RootCauseCategoryEnum = z.enum([
  "soft_decline",
  "hard_decline",
  "ambiguous",
]);

export type RootCauseCategory = z.infer<typeof RootCauseCategoryEnum>;

/** How the classification was determined */
export const ClassificationMethodEnum = z.enum(["lookup_table", "llm"]);

export const DiagnosisSchema = z.object({
  event_id: z.string(),

  /** soft_decline | hard_decline | ambiguous */
  root_cause_category: RootCauseCategoryEnum,

  /** Matches error_reason or a normalized label */
  root_cause_label: z.string(),

  /** 1.0 for deterministic lookup, <1.0 for model-classified */
  confidence: z.number().min(0).max(1),

  /** lookup_table | llm */
  classification_method: ClassificationMethodEnum,

  /** Human-readable justification for the classification */
  reasoning: z.string(),

  /**
   * Advisory timing hint from classifier (e.g., "retry after salary credit").
   * Does NOT override Policy Engine windows or guardrail G-2 ceilings.
   */
  suggested_timing_hint: z.string().nullable(),
});

export type Diagnosis = z.infer<typeof DiagnosisSchema>;

// ---------------------------------------------------------------------------
// 5.3 PolicyDecision (Policy Engine output)
// ---------------------------------------------------------------------------

/** Possible recovery actions */
export const ActionTypeEnum = z.enum([
  "schedule_retry",
  "send_nudge",
  "escalate",
  "no_action",
]);

export type ActionType = z.infer<typeof ActionTypeEnum>;

export const PolicyDecisionSchema = z.object({
  event_id: z.string(),

  /** The recovery action to take */
  action_type: ActionTypeEnum,

  /** Identifier of the rule from SPEC Section 7 table that fired */
  rule_fired: z.string(),

  /** ISO 8601 — only populated when action_type === "schedule_retry" */
  retry_at: z.string().datetime().nullable(),

  /** Maximum retry attempts allowed by policy for this category */
  max_attempts_allowed: z.number().int().nonnegative(),

  /** Current attempt number from the input event */
  current_attempt: z.number().int().positive(),

  /** Guardrail ID (G-1 through G-6) if a guardrail overrode the base rule */
  guardrail_triggered: z.string().nullable(),

  /** Human-readable explanation of the decision */
  explanation: z.string(),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

// ---------------------------------------------------------------------------
// 5.4 ActionResult (Action Executor output)
// ---------------------------------------------------------------------------

/** What action was actually taken */
export const ActionTakenEnum = z.enum([
  "razorpay_retry_charge",
  "message_generated",
  "escalated",
  "none",
]);

/** Outcome of the action */
export const OutcomeEnum = z.enum([
  "recovered",
  "still_failed",
  "message_sent",
  "escalated",
  "skipped",
]);

export const ActionResultSchema = z.object({
  event_id: z.string(),

  /** The action that was actually executed */
  action_taken: ActionTakenEnum,

  /** Razorpay request/response identifier, if an API call was made */
  api_call_id: z.string().nullable(),

  /** Result of the action */
  outcome: OutcomeEnum,

  /** Amount recovered in paise, 0 if not recovered */
  amount_recovered: z.number().int().nonnegative(),

  /** ISO 8601 timestamp of execution */
  executed_at: z.string().datetime(),

  /** Pointer to stored raw API response, if applicable */
  raw_api_response_ref: z.string().nullable(),
});

export type ActionResult = z.infer<typeof ActionResultSchema>;

// ---------------------------------------------------------------------------
// 5.5 AuditLogEntry (final, append-only per R-2)
// ---------------------------------------------------------------------------

export const AuditLogEntrySchema = z.object({
  event_id: z.string(),

  /** The original input event */
  event: RecoveryEventSchema,

  /** Classifier output */
  diagnosis: DiagnosisSchema,

  /** Policy Engine output */
  policy_decision: PolicyDecisionSchema,

  /** Action Executor output */
  action_result: ActionResultSchema,

  /** Version string of the pipeline that produced this entry */
  pipeline_version: z.string(),

  /** ISO 8601 timestamp of when this entry was logged */
  logged_at: z.string().datetime(),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
