import 'dotenv/config';
import { classifyEvent } from './classifier.js';
import { evaluatePolicy } from './policyEngine.js';
import { executeAction, CONFIG } from './actionExecutor.js';
import { logAuditEntry } from './auditLogger.js';
import { askLLMToGenerateMessage } from './llmClient.js';
import { RecoveryEvent, AuditLogEntry } from './schemas.js';

const DEMO_EVENT: RecoveryEvent = {
  event_id:          "evt_demo_live_002",
  event_type:        "subscription.charge.failed",
  subscription_id:   "sub_demo_razorpay",
  payment_id:        "pay_demo_002",
  customer_id:       "cust_demo_001",
  customer_name:     "Priya Sharma",
  amount:            99900,          // ₹999.00 (in paise)
  currency:          "INR",
  error_code:        "BAD_REQUEST_ERROR",
  error_description: "Your payment could not be completed.",
  error_reason:      "insufficient_funds",
  error_source:      "issuer_bank",
  error_step:        "payment_authorization",
  payment_method:    "card",
  card_last4:        "4242",
  attempt_number:    1,
  first_failed_at:   new Date().toISOString(),
  event_timestamp:   new Date().toISOString(),
  customer_opted_out: false
};

export async function runLiveDemo(emit: (msg: string) => void) {
  const line = '─'.repeat(60);
  const log = (msg: string) => emit(msg + '\n');
  const banner = (text: string) => log(`\n${line}\n  ${text}\n${line}`);
  const step = (n: number, label: string) => log(`\n[STEP ${n}] ${label}`);
  const field = (key: string, value: any) => log(`  ${key.padEnd(28)} ${value}`);

  banner('🚀  RAZORPAY SUBSCRIPTION RECOVERY ENGINE  —  LIVE DEMO');
  log(`\n  Mode:  ${CONFIG.DRY_RUN ? '🔵 DRY RUN (simulation)' : '🔴 LIVE — Razorpay Test Mode API active'}`);
  log(`  Time:  ${new Date().toISOString()}\n`);

  field('Event ID',        DEMO_EVENT.event_id);
  field('Customer',        `${DEMO_EVENT.customer_name} (${DEMO_EVENT.customer_id})`);
  field('Amount',         `₹${(DEMO_EVENT.amount / 100).toFixed(2)}`);
  field('Failure Reason',  DEMO_EVENT.error_reason);
  field('Payment Method',  DEMO_EVENT.payment_method);
  field('Attempt #',       DEMO_EVENT.attempt_number);

  // ── Step 1: Classify ─────────────────────────────────────────────────────
  step(1, 'CLASSIFIER — Deterministic lookup + LLM timing intelligence');
  log('  Calling classifier...');
  const diagnosis = await classifyEvent(DEMO_EVENT);

  field('Category',        diagnosis.root_cause_category);
  field('Label',           diagnosis.root_cause_label);
  field('Method',          diagnosis.classification_method);
  field('Confidence',      diagnosis.confidence);
  field('Reasoning',       diagnosis.reasoning);
  field('Timing Hint',     diagnosis.suggested_timing_hint || '(none)');

  // ── Step 2: Policy Engine ─────────────────────────────────────────────────
  step(2, 'POLICY ENGINE — Rule evaluation with timing override');
  const decision = evaluatePolicy(diagnosis, DEMO_EVENT, diagnosis.suggested_timing_hint);

  field('Action Type',     decision.action_type);
  field('Rule Fired',      decision.rule_fired);
  field('Retry At',        decision.retry_at || '(N/A)');
  field('Max Attempts',    decision.max_attempts_allowed);
  field('Guardrail',       decision.guardrail_triggered || 'None');
  field('Explanation',     decision.explanation);

  // ── Step 3: Generate Recovery Message (if applicable) ────────────────────
  let messagePayload: string | null = null;
  if (decision.action_type === 'send_nudge' || decision.action_type === 'escalate') {
    step(3, 'LLM MESSAGE GENERATOR — Hinglish recovery outreach');
    log('  Generating Hinglish customer message...');
    messagePayload = await askLLMToGenerateMessage(DEMO_EVENT);
    field('Recovery Message', messagePayload || '(generation failed)');
  } else {
    step(3, 'LLM MESSAGE GENERATOR — Skipped (action is schedule_retry)');
    log('  No outreach message needed for schedule_retry action.');
  }

  // ── Step 4: Execute Action ─────────────────────────────────────────────────
  step(4, `ACTION EXECUTOR — ${CONFIG.DRY_RUN ? 'DRY RUN simulation' : 'LIVE Razorpay Test Mode API call'}`);
  if (!CONFIG.DRY_RUN) {
    log('  ⚡ Calling razorpay.paymentLink.create() ...');
  }
  const result = await executeAction(decision, DEMO_EVENT, messagePayload);

  field('Action Taken',    result.action_taken);
  field('Outcome',         result.outcome);
  field('Amount',          result.amount_recovered ? `₹${(result.amount_recovered / 100).toFixed(2)}` : '₹0.00');
  field('API Call ID',     result.api_call_id || '(none)');
  if (result.raw_api_response_ref) {
    field('API Error',     result.raw_api_response_ref);
  }

  // ── Step 5: Audit Log ──────────────────────────────────────────────────────
  step(5, 'AUDIT LOGGER — Append-only JSONL write (R-2)');
  const logEntry: AuditLogEntry = {
    event_id:        DEMO_EVENT.event_id,
    event:           DEMO_EVENT,
    diagnosis,
    policy_decision: decision,
    action_result:   result,
    pipeline_version: "1.0.0",
    logged_at:       new Date().toISOString()
  };
  logAuditEntry(logEntry);
  log('  ✅ Entry appended to audit_log.jsonl');

  // ── Summary ────────────────────────────────────────────────────────────────
  banner('✅  DEMO COMPLETE');
  log('\n');

  if (!CONFIG.DRY_RUN && result.api_call_id && result.api_call_id !== 'dry_run_retry_id') {
    log(`  🎉 Payment link created on Razorpay Test Mode!`);
    log(`     Link ID:  ${result.api_call_id}`);
    log(`     Verify:   https://dashboard.razorpay.com/app/payment-links`);
    log(`     (Check Test Mode dashboard — the link should appear within seconds)\n`);
  } else if (CONFIG.DRY_RUN) {
    log('  ℹ️  Running in DRY_RUN mode. Set DRY_RUN=false in .env to hit Razorpay live.');
    log(`     Simulated API Call ID: ${result.api_call_id}\n`);
  } else {
    log('  ⚠️  Action result: ' + result.outcome + ' — ' + result.raw_api_response_ref);
    log('     This may be a Razorpay Test Mode rate limit. Try again in a moment.\n');
  }

  log('  Pipeline stages completed: Classify → Policy → Message → Execute → Audit');
  log(`  Full record written to audit_log.jsonl (event_id: ${DEMO_EVENT.event_id})\n`);
  log('DONE');
}
