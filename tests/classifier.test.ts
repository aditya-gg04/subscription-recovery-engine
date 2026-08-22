import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyEvent } from '../src/classifier.js';
import * as llmClient from '../src/llmClient.js';
import { RecoveryEvent, RootCauseCategory } from '../src/schemas.js';

// Mock the LLM client
vi.mock('../src/llmClient.js', () => ({
  askLLMToClassify: vi.fn(),
  askLLMForTimingHint: vi.fn(),
}));

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

describe('Classifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T3.1: Should return deterministic classification for mapped reason', async () => {
    const event = createDummyEvent({ error_reason: 'insufficient_funds', payment_method: 'card' });
    const diagnosis = await classifyEvent(event);

    expect(diagnosis.root_cause_category).toBe('soft_decline');
    expect(diagnosis.confidence).toBe(1.0);
    expect(diagnosis.classification_method).toBe('lookup_table');
    expect(llmClient.askLLMToClassify).not.toHaveBeenCalled();
  });

  it('T4.2: Should route unmapped reason to LLM', async () => {
    const event = createDummyEvent({ error_reason: 'some_unknown_error', payment_method: 'card' });
    
    // Setup mock return
    vi.mocked(llmClient.askLLMToClassify).mockResolvedValue({
      root_cause_category: 'ambiguous',
      reasoning: 'Model determined ambiguous'
    });
    vi.mocked(llmClient.askLLMForTimingHint).mockResolvedValue('Try again tomorrow');

    const diagnosis = await classifyEvent(event);

    expect(diagnosis.root_cause_category).toBe('ambiguous');
    expect(diagnosis.confidence).toBe(0.8);
    expect(diagnosis.classification_method).toBe('llm');
    expect(diagnosis.reasoning).toBe('Model determined ambiguous');
    expect(diagnosis.suggested_timing_hint).toBe('Try again tomorrow');
    
    expect(llmClient.askLLMToClassify).toHaveBeenCalledWith(event);
    expect(llmClient.askLLMForTimingHint).toHaveBeenCalledWith(event);
  });
  
  it('T4.2: Should route mapped ambiguous reason to LLM for further detail', async () => {
    const event = createDummyEvent({ error_reason: 'card_declined', payment_method: 'card' });
    
    // Setup mock return
    vi.mocked(llmClient.askLLMToClassify).mockResolvedValue({
      root_cause_category: 'hard_decline', // LLM resolves it
      reasoning: 'Model figured it out'
    });
    vi.mocked(llmClient.askLLMForTimingHint).mockResolvedValue(null);

    const diagnosis = await classifyEvent(event);

    expect(diagnosis.root_cause_category).toBe('hard_decline');
    expect(diagnosis.confidence).toBe(0.8);
    expect(diagnosis.classification_method).toBe('llm');
    expect(llmClient.askLLMToClassify).toHaveBeenCalledWith(event);
  });
});
