import * as fs from 'fs';
import { RecoveryEvent } from './src/schemas.js';

// Simple pseudo-random number generator for fixed seed
class PRNG {
  private seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  randint(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  choice<T>(arr: T[]): T {
    return arr[this.randint(0, arr.length - 1)];
  }
}

const prng = new PRNG(12345);

const softReasons = [
  'payment_timed_out',
  'gateway_technical_error',
  'payment_cancelled',
  'bank_downtime',
  'insufficient_funds',
  'transaction_limit_exceeded'
];

const hardReasons = [
  'card_not_enrolled',
  'card_disabled_for_online_payments',
  'payment_risk_check_failed', // Severe
  'incorrect_cvv',
  'debit_instrument_inactive',
  'debit_instrument_blocked',
  'card_expired', // Severe
  'do_not_honor' // Severe (added for testing)
];

const ambiguousReasons = [
  'card_declined',
  'authentication_failed',
  'payment_failed',
  'vpa_resolution_failed'
];

const unmappedReason = 'some_new_unknown_error';

function generateEvent(id: number): RecoveryEvent {
  const r = prng.next();
  let reason = '';
  if (id === 1) {
    // Ensure at least one unmapped reason
    reason = unmappedReason;
  } else if (r < 0.6) {
    reason = prng.choice(softReasons);
  } else if (r < 0.85) {
    reason = prng.choice(hardReasons);
  } else {
    reason = prng.choice(ambiguousReasons);
  }

  const isOptedOut = id === 2 ? true : prng.next() < 0.05; // ID 2 is guaranteed opt-out

  const now = new Date('2026-08-22T10:00:00Z').getTime();
  const firstFailedAt = new Date(now - prng.randint(0, 10) * 86400000).toISOString();
  const eventTimestamp = new Date(now).toISOString();

  return {
    event_id: `evt_${id.toString().padStart(5, '0')}`,
    event_type: 'subscription.charge.failed',
    subscription_id: `sub_${prng.randint(1000, 9999)}`,
    payment_id: `pay_${prng.randint(1000, 9999)}`,
    customer_id: `cust_${prng.randint(100, 999)}`,
    customer_name: `Customer ${id}`,
    amount: prng.choice([49900, 99900, 149900, 199900]),
    currency: 'INR',
    error_code: 'BAD_REQUEST_ERROR',
    error_description: 'Payment failed due to simulated reason.',
    error_reason: reason,
    error_source: prng.choice(['customer', 'business', 'internal', 'gateway', 'issuer_bank']),
    error_step: prng.choice(['payment_authentication', 'payment_authorization']),
    payment_method: prng.choice(['card', 'upi']),
    card_last4: '1234',
    attempt_number: prng.randint(1, 5),
    first_failed_at: firstFailedAt,
    event_timestamp: eventTimestamp,
    customer_opted_out: isOptedOut
  };
}

const totalEvents = 100; // 80-120
const events: RecoveryEvent[] = [];
for (let i = 1; i <= totalEvents; i++) {
  events.push(generateEvent(i));
}

const holdoutCount = Math.floor(totalEvents * 0.2);
const holdoutSet = events.slice(0, holdoutCount);
const devSet = events.slice(holdoutCount);

fs.writeFileSync('synthetic_events.json', JSON.stringify(devSet, null, 2));
fs.writeFileSync('synthetic_events_holdout.json', JSON.stringify(holdoutSet, null, 2));

console.log(`Generated ${totalEvents} events.`);
console.log(`Dev set: ${devSet.length}`);
console.log(`Holdout set: ${holdoutSet.length}`);

// Verify constraints for T2.2
const hasOptOut = events.some(e => e.customer_opted_out);
const hasUnmapped = events.some(e => e.error_reason === unmappedReason);
console.log(`Has opted_out=true: ${hasOptOut}`);
console.log(`Has unmapped reason: ${hasUnmapped}`);
