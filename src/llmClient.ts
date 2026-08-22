/**
 * llmClient.ts — LLM integration layer.
 *
 * Gemini primary (@google/generative-ai), Groq fallback (groq-sdk).
 * Exposes exactly 3 tools per R-8:
 *   - classify_failure
 *   - generate_recovery_message
 *   - suggest_retry_timing
 *
 * No tool that executes a charge, retry, or refund is exposed. (R-7, R-8)
 *
 * Satisfies: SPEC Section 9, R-7, R-8
 * Implementation: Day 4 (T4.1)
 */

// TODO: T4.1 — Gemini primary + Groq fallback with constrained tool set
