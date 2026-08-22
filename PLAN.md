# PLAN.md — Build Plan for Recovery Agent

Derived from `SPEC.md` v1.0. Every task below cites the requirement(s) it exists to satisfy. If you find yourself building something with no requirement citation, stop and check whether it belongs in the spec first.

Build order follows the dependency chain in Section 4 of the spec: contracts → deterministic core (Classifier lookup + Policy Engine + guardrails) → LLM layer → executor → audit/metrics → dashboard. Deterministic, network-free pieces come before anything touching Razorpay or an LLM, so you always have a fast, reliable test loop.

---

## Day 1 — Contracts + real Razorpay values

- [ ] T1.1 — Set up repo skeleton per Section 15 (`package.json`, `tsconfig.json`, folder structure). *(NFR-2 groundwork)*
- [x] T1.2 — Pull real Razorpay error/reason/source/step values from Razorpay's docs. *(R-1)* — Done for `card` and `upi` payment methods (Cards Error Codes, UPI Error Codes, Common Errors, Error Parameters pages). Remaining: verify `error_step` enum against a live Test Mode webhook payload directly (Razorpay's docs describe `step` per method, not as one unified list); add `netbanking` and `emandate` reason codes before those payment methods appear in synthetic data.
- [ ] T1.3 — Write `schemas.ts`: Zod schemas for `RecoveryEvent`, `Diagnosis`, `PolicyDecision`, `ActionResult`, `AuditLogEntry`. *(Section 5, all subsections)*
- [x] T1.4 — Draft `classification_rules.yaml` using the real values from T1.2, structured per the Section 6 table (soft_decline / hard_decline / ambiguous). *(R-4, AC-5)* — Done for card/upi; see file header for source URLs.
- [ ] T1.5 — Draft `policy_rules.yaml` encoding the Section 7 rule table exactly (rule IDs, conditions, actions, constraints). *(Section 7)*

## Day 2 — Synthetic data + guardrail tests (written before implementation, TDD-style)

- [ ] T2.1 — Write `generate-synthetic-events.ts`: produces 80-120 `RecoveryEvent` records, fixed seed, category distribution per spec, held-out split written to a separate file. *(R-9)*
- [ ] T2.2 — Confirm the generated set includes: ≥1 `customer_opted_out = true` record, ≥1 unmapped `error_reason` record. *(R-9, feeds R-3/G-4 test coverage)*
- [ ] T2.3 — Write `tests/guardrails.test.ts` covering G-1 through G-5, against hand-constructed `Diagnosis`/`PolicyDecision` fixtures — no dependency on the Classifier or Policy Engine implementation yet (tests should fail red at this point). *(R-6, AC-2)*
- [ ] T2.4 — Write `tests/policyEngine.test.ts` covering the base rule table (Section 7) and the rule-evaluation order in R-5 (OPT_OUT → guardrails → base rules).

## Day 3 — Deterministic core: Classifier (lookup path) + Policy Engine

- [ ] T3.1 — Implement `classifier.ts` deterministic lookup path only (no LLM yet): maps known `error_reason` → `Diagnosis` via `classification_rules.yaml`. *(Section 6, R-3 partial — unmapped reasons should throw/flag for now, LLM path comes Day 4)*
- [ ] T3.2 — Implement `policyEngine.ts` as a pure function per Section 7/8, satisfying R-5. Wire in G-1 through G-5 as explicit checks (not prompted behavior). *(G3, R-5, R-6)*
- [ ] T3.3 — Get T2.3 and T2.4 tests passing against this implementation. *(AC-2)*
- [ ] T3.4 — Add the `DRY_RUN` config flag (G-6) plumbed through to wherever the Action Executor will read it. *(NFR-3)*

## Day 4 — LLM layer (ambiguous classification, reasoning, messaging, timing)

- [ ] T4.1 — Implement `llmClient.ts`: Gemini primary via `@google/generative-ai`, Groq fallback via `groq-sdk`. Define the three tools exactly per R-8: `classify_failure`, `generate_recovery_message`, `suggest_retry_timing` — no charge/retry/refund tool exposed. *(R-7, R-8)*
- [ ] T4.2 — Extend `classifier.ts` to route unmapped `error_reason` values to the LLM's `classify_failure` tool, populating `classification_method: "llm"` and `confidence < 1.0`. *(R-3, Section 5.2)*
- [ ] T4.3 — Wire `generate_recovery_message` and `suggest_retry_timing` as advisory inputs only — confirm in code review that neither can bypass Policy Engine ceilings (G-1/G-2) or guardrail G-3's never-retry list. *(R-7, G-3)*
- [ ] T4.4 — Add a test asserting no code path allows the LLM output to directly trigger `actionExecutor`'s Razorpay call function. *(AC-6)*

## Day 5 — Action Executor + Audit Logger

- [ ] T5.1 — Implement `actionExecutor.ts`: consumes a `PolicyDecision`, produces an `ActionResult`. Enforce G-5 (amount-match check) before any live call. Respect `DRY_RUN` (G-6). *(Section 5.4, G-5, G-6)*
- [ ] T5.2 — Wire the real `razorpay` npm SDK call for `schedule_retry` actions (Test Mode credentials only). *(G4, NG4)*
- [ ] T5.3 — Implement `auditLogger.ts`: appends one `AuditLogEntry` per event to `audit_log.jsonl`, enforcing append-only (R-2) — no update/delete function should exist on this module at all.
- [ ] T5.4 — Implement `runBatch.ts`: wires Event Source → Classifier → Policy Engine → Action Executor → Audit Logger end to end over the full synthetic batch. *(NFR-2, AC-1)*
- [ ] T5.5 — Run `runBatch.ts` with `DRY_RUN=true` first; confirm no exceptions, one audit entry per input event. *(AC-1)*

## Day 6 — Metrics + Dashboard

- [ ] T6.1 — Implement `metrics.ts`: recovery rate, amount recovered, per-category breakdown, guardrail-trigger count, exception list — computed strictly from the held-out subset. *(Section 11, R-10)*
- [ ] T6.2 — Confirm at least one `guardrail_triggered` entry exists in the held-out run output; if not, adjust synthetic data (T2.1) until one does, rather than skipping this. *(AC-3)*
- [ ] T6.3 — Scaffold the Vite + React dashboard: metrics header, category breakdown table, batch run table, per-event drill-down, exception list panel — reading `audit_log.json` via `fetch`. *(Section 14, no new spec requirement — this is a reporting view over data already validated in T6.1)*
- [ ] T6.4 — Verify AC-4: metrics shown in the dashboard match a manual recomputation from `audit_log.jsonl` alone.

## Day 7 — Reconciliation + acceptance pass

- [ ] T7.1 — Reconcile `classification_rules.yaml` and `policy_rules.yaml` fully against real Razorpay documentation; remove all placeholder values. *(AC-5)*
- [ ] T7.2 — Re-run the full batch (T5.4) after T7.1's changes, regenerate metrics (T6.1) on the final rule set.
- [ ] T7.3 — Walk every checkbox in Section 13 of `SPEC.md` (AC-1 through AC-6) and confirm each is genuinely satisfied, not assumed.
- [ ] T7.4 — Code review pass specifically for R-7/R-8 (no LLM-to-money-action path) and R-2 (audit log is truly append-only in every code path that touches it).

---

## Explicitly not scheduled (per spec Non-Goals)

Do not spend time on: real message dispatch (NG1), non-subscription failure surfaces (NG2), auth/multi-tenant (NG3), any live-mode payment path (NG4). If a task file, ticket, or idea shows up that falls into these, it's out of scope for this build — note it as a "future work" line, don't build it.
