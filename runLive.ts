/**
 * runLive.ts — Single-event live demo script.
 *
 * Demonstrates the full recovery pipeline end-to-end against
 * Razorpay Test Mode API with step-by-step console output.
 *
 * Usage:
 *   npx ts-node --esm runLive.ts
 *
 * Prerequisites:
 *   - DRY_RUN=false in .env
 *   - RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET set in .env
 *   - GEMINI_API_KEY set in .env
 */
import 'dotenv/config';
import { fileURLToPath } from 'url';
import * as path from 'path';

import { classifyEvent } from './src/classifier.js';
import { evaluatePolicy } from './src/policyEngine.js';
import { executeAction, CONFIG } from './src/actionExecutor.js';
import { logAuditEntry } from './src/auditLogger.js';
import { askLLMToGenerateMessage } from './src/llmClient.js';
import { RecoveryEvent, AuditLogEntry } from './src/schemas.js';

const __filename = fileURLToPath(import.meta.url);

// ─── Demo Event ────────────────────────────────────────────────────────────────
// A realistic insufficient_funds failure — the most timing-sensitive case,
// demonstrating salary-date intelligence from Section 7.2.
const DEMO_EVENT: RecoveryEvent = {
  event_id:          "evt_demo_live_001",
  event_type:        "subscription.charge.failed",
  subscription_id:   "sub_demo_razorpay",
  payment_id:        "pay_demo_001",
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function banner(text: string) {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(line);
}

function step(n: number, label: string) {
  console.log(`\n[STEP ${n}] ${label}`);
}

function field(key: string, value: any) {
  console.log(`  ${key.padEnd(28)} ${value}`);
}

// ─── Main Demo ────────────────────────────────────────────────────────────────
async function runLiveDemo() {
  banner('🚀  RAZORPAY SUBSCRIPTION RECOVERY ENGINE  —  LIVE DEMO');

  console.log(`\n  Mode:  ${CONFIG.DRY_RUN ? '🔵 DRY RUN (simulation)' : '🔴 LIVE — Razorpay Test Mode API active'}`);
  console.log(`  Time:  ${new Date().toISOString()}\n`);

  field('Event ID',        DEMO_EVENT.event_id);
  field('Customer',        `${DEMO_EVENT.customer_name} (${DEMO_EVENT.customer_id})`);
  field('Amount',         `₹${(DEMO_EVENT.amount / 100).toFixed(2)}`);
  field('Failure Reason',  DEMO_EVENT.error_reason);
  field('Payment Method',  DEMO_EVENT.payment_method);
  field('Attempt #',       DEMO_EVENT.attempt_number);

  // ── Step 1: Classify ─────────────────────────────────────────────────────
  step(1, 'CLASSIFIER — Deterministic lookup + LLM timing intelligence');
  console.log('  Calling classifier...');
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
    console.log('  Generating Hinglish customer message...');
    messagePayload = await askLLMToGenerateMessage(DEMO_EVENT);
    field('Recovery Message', messagePayload || '(generation failed)');
  } else {
    step(3, 'LLM MESSAGE GENERATOR — Skipped (action is schedule_retry)');
    console.log('  No outreach message needed for schedule_retry action.');
  }

  // ── Step 4: Execute Action ─────────────────────────────────────────────────
  step(4, `ACTION EXECUTOR — ${CONFIG.DRY_RUN ? 'DRY RUN simulation' : 'LIVE Razorpay Test Mode API call'}`);
  if (!CONFIG.DRY_RUN) {
    console.log('  ⚡ Calling razorpay.paymentLink.create() ...');
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
  console.log('  ✅ Entry appended to audit_log.jsonl');

  // ── Summary ────────────────────────────────────────────────────────────────
  banner('✅  DEMO COMPLETE');
  console.log();

  if (!CONFIG.DRY_RUN && result.api_call_id && result.api_call_id !== 'dry_run_retry_id') {
    console.log(`  🎉 Payment link created on Razorpay Test Mode!`);
    console.log(`     Link ID:  ${result.api_call_id}`);
    console.log(`     Verify:   https://dashboard.razorpay.com/app/payment-links`);
    console.log(`     (Check Test Mode dashboard — the link should appear within seconds)\n`);
  } else if (CONFIG.DRY_RUN) {
    console.log('  ℹ️  Running in DRY_RUN mode. Set DRY_RUN=false in .env to hit Razorpay live.');
    console.log(`     Simulated API Call ID: ${result.api_call_id}\n`);
  } else {
    console.log('  ⚠️  Action result:', result.outcome, '—', result.raw_api_response_ref);
    console.log('     This may be a Razorpay Test Mode rate limit. Try again in a moment.\n');
  }

  console.log('  Pipeline stages completed: Classify → Policy → Message → Execute → Audit');
  console.log(`  Full record written to audit_log.jsonl (event_id: ${DEMO_EVENT.event_id})\n`);
}

runLiveDemo().catch(err => {
  console.error('\n❌ Demo failed with error:', err);
  process.exit(1);
});
