/**
 * classifier.ts — Classifies failed-payment events into root-cause categories.
 *
 * Two paths:
 *   1. Deterministic lookup: error_reason → category via classification_rules.yaml
 *   2. LLM fallback: unmapped/ambiguous reasons routed to Gemini/Groq
 *
 * Satisfies: SPEC Section 6, R-3, R-4
 * Implementation: Day 3 (T3.1) + Day 4 (T4.2)
 */

// TODO: T3.1 — deterministic lookup path
// TODO: T4.2 — LLM fallback path
