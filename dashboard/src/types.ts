export interface RecoveryEvent {
  event_id: string;
  event_type: string;
  subscription_id: string | null;
  payment_id: string;
  customer_id: string;
  customer_name: string;
  amount: number;
  currency: string;
  error_code: string;
  error_description: string;
  error_reason: string;
  error_source: string;
  error_step: string;
  payment_method: string;
  card_last4: string | null;
  attempt_number: number;
  first_failed_at: string;
  event_timestamp: string;
  customer_opted_out: boolean;
}

export interface Diagnosis {
  event_id: string;
  root_cause_category: 'soft_decline' | 'hard_decline' | 'ambiguous';
  root_cause_label: string;
  confidence: number;
  classification_method: 'lookup_table' | 'llm';
  reasoning: string;
  suggested_timing_hint: string | null;
}

export interface PolicyDecision {
  event_id: string;
  action_type: 'schedule_retry' | 'send_nudge' | 'escalate' | 'no_action';
  rule_fired: string;
  retry_at: string | null;
  max_attempts_allowed: number;
  current_attempt: number;
  guardrail_triggered: string | null;
  explanation: string;
}

export interface ActionResult {
  event_id: string;
  action_taken: string;
  api_call_id: string | null;
  outcome: string;
  amount_recovered: number;
  executed_at: string;
  raw_api_response_ref: string | null;
}

export interface AuditLogEntry {
  event_id: string;
  event: RecoveryEvent;
  diagnosis: Diagnosis;
  policy_decision: PolicyDecision;
  action_result: ActionResult;
  pipeline_version: string;
  logged_at: string;
}
