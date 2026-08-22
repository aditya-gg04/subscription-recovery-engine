import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('LLM Security and Isolation (R-7/R-8)', () => {
  it('T4.4: llmClient should not import actionExecutor or razorpay SDK', () => {
    const llmClientPath = path.resolve(__dirname, '../src/llmClient.ts');
    const content = fs.readFileSync(llmClientPath, 'utf8');

    // Assertion 1: llmClient must not import the action executor
    expect(content).not.toMatch(/import.*actionExecutor/);
    expect(content).not.toMatch(/require.*actionExecutor/);

    // Assertion 2: llmClient must not import the razorpay SDK
    expect(content).not.toMatch(/import.*razorpay/);
    expect(content).not.toMatch(/require.*razorpay/);
  });

  it('T4.4: The LLM tools must be constrained to the 3 allowed tools', () => {
    const llmClientPath = path.resolve(__dirname, '../src/llmClient.ts');
    const content = fs.readFileSync(llmClientPath, 'utf8');

    // Ensure it doesn't expose unauthorized tools like "execute_charge" or "retry_payment"
    expect(content).not.toMatch(/name:\s*['"]execute_charge['"]/);
    expect(content).not.toMatch(/name:\s*['"]retry_payment['"]/);
    
    // Ensure the required tools are present
    expect(content).toMatch(/name:\s*['"]classify_failure['"]/);
    expect(content).toMatch(/name:\s*['"]suggest_retry_timing['"]/);
    expect(content).toMatch(/name:\s*['"]generate_recovery_message['"]/);
  });
});
