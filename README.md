# 🛡️ Razorpay Subscription Revenue Recovery Agent

An autonomous, AI-assisted failed-payment recovery engine designed for **Razorpay recurring subscriptions (Cards, UPI, Netbanking, eMandate)**. 

The system combines a **deterministic zero-trust policy engine**, an **official Razorpay error taxonomy**, **Gemini 3.6 Flash / Groq LLM intelligence**, and an **interactive Vite + React analytics dashboard** to recover lost subscription revenue while guaranteeing strict code-level guardrail compliance.

[![Watch Demo Video](https://img.youtube.com/vi/NsxGomrEi4E/maxresdefault.jpg)](https://youtu.be/NsxGomrEi4E)

> 🎥 **[Click here to watch the full Video Walkthrough on YouTube](https://youtu.be/NsxGomrEi4E)**

---

## ⚡ Key Highlights & Capabilities

- 🛡️ **Zero-Trust Policy Core**: Code-level guardrails (G-1 through G-5) override AI recommendations—guaranteeing zero double-charging, enforced cooldown periods, retry caps, and strict compliance with customer opt-outs.
- 🎯 **Razorpay Root Cause Taxonomy**: Maps 50+ exact Razorpay error reasons (`error_reason`, `error_source`, `error_step`) into `soft_decline`, `hard_decline`, and `ambiguous` via [`classification_rules.yaml`](file:///home/aditya/dev/Razorpay/classification_rules.yaml).
- 🧠 **Dual LLM Intelligence & Fallback**: Uses Google's `gemini-3.6-flash` (primary) and Groq `openai/gpt-oss-20b` (fallback) via structured function-calling for edge-case classification, timing optimization, and intent detection.
- 💡 **Salary-Credit Timing Optimization**: Analyzes timing hints for `insufficient_funds` (e.g., Indian end-of-month salary dates) to schedule smart retry windows instead of static 24h retries.
- 💬 **Promise-to-Pay (PTP) Nudges & Voice Recovery**: Interactive Hinglish chat nudges + browser SpeechSynthesis voice recovery that automatically reschedules retries when customers promise to pay.
- 🚀 **Resilient API Executor**: Enforces inter-call spacing queues (`waitForCallSlot()`) and 3-stage exponential backoff (`callWithBackoff()`) on HTTP 429 rate-limits when calling Razorpay Test Mode Payment Links API (`razorpay.paymentLink.create`).
- 📊 **Real-Time Analytics Dashboard**: Vite + React dashboard featuring recovery KPIs, guardrail trigger tallies, interactive event modal, and append-only audit trail.

---

## 🏗️ Architecture & Data Pipeline

```
  [ Recovery Event ]  (Razorpay Webhook / Synthetic Input)
          │
          ▼
┌──────────────────┐    Deterministic Lookup Table (classification_rules.yaml)
│    Classifier    │ ───▶ Fallback to LLM (Gemini 3.6 Flash / Groq) for unmapped reasons
└──────────────────┘
          │  Diagnosis Object (Category, Confidence, Reasoning, Timing Hints)
          ▼
┌──────────────────┐    R-5 Execution Rule Order:
│  Policy Engine   │ ───▶ 1. Check OPT_OUT flag
└──────────────────┘    2. Enforce Guardrails (G1-G5: Retry Caps, Cooldown, Hard Decline)
          │             3. Evaluate Policy Rules (policy_rules.yaml)
          ▼  PolicyDecision Object (Action, Retry Window, Guardrail Triggered)
┌──────────────────┐
│ Action Executor  │ ───▶ Dry-Run Mode (G-6) OR Razorpay Test Mode Payment Links API
└──────────────────┘      (with 1000ms call spacing & 429 exponential backoff)
          │
          ▼
┌──────────────────┐
│  Audit Logger    │ ───▶ Append-Only File (audit_log.jsonl)
└──────────────────┘
          │
          ▼
┌──────────────────┐
│ React Dashboard  │ ───▶ Live Metrics, KPI Breakdown, PTP Chat & Hinglish Voice Recovery
└──────────────────┘
```

---

## 🛡️ Guardrails Reference Table

| Guardrail ID | Name | Description | Enforcement Point |
| :--- | :--- | :--- | :--- |
| **G-1** | Max Retry Cap | Hard ceiling of **2 retries** for soft declines; 0 for hard declines. | [`policyEngine.ts`](file:///home/aditya/dev/Razorpay/src/policyEngine.ts) |
| **G-2** | Cooldown Period | Enforces **≥24h window** between retries; overrides model suggestions. | [`policyEngine.ts`](file:///home/aditya/dev/Razorpay/src/policyEngine.ts) |
| **G-3** | Never-Retry Hard Declines | Permanently blocks retries on hard declines (e.g., `payment_risk_check_failed`). | [`policyEngine.ts`](file:///home/aditya/dev/Razorpay/src/policyEngine.ts) |
| **G-4** | Opt-Out Respect | Immediately stops all intervention if `customer_opted_out = true`. | [`policyEngine.ts`](file:///home/aditya/dev/Razorpay/src/policyEngine.ts) |
| **G-5** | Amount Match | Asserts requested retry amount matches original event amount exactly before API call. | [`actionExecutor.ts`](file:///home/aditya/dev/Razorpay/src/actionExecutor.ts) |
| **G-6** | Global Dry Run | Bypasses live network I/O in simulation mode (`DRY_RUN=true`). | [`actionExecutor.ts`](file:///home/aditya/dev/Razorpay/src/actionExecutor.ts) |

---

## 📂 Codebase Structure

```
.
├── src/
│   ├── schemas.ts              # Zod schemas & TypeScript interfaces
│   ├── classifier.ts           # Root-cause taxonomy lookup & LLM fallback router
│   ├── policyEngine.ts         # Deterministic policy engine & guardrail enforcement
│   ├── llmClient.ts            # Gemini 3.6 Flash & Groq function calling client
│   ├── actionExecutor.ts       # Razorpay Payment Link API client with 429 backoff
│   ├── auditLogger.ts          # Append-only audit logger (audit_log.jsonl)
│   ├── metrics.ts              # KPI computation & held-out dataset evaluator
│   ├── server.ts               # Express API backend for dashboard & PTP chat
│   └── runBatch.ts             # Batch runner over synthetic dataset
├── dashboard/                  # Vite + React + TypeScript Dashboard
│   ├── src/
│   │   ├── App.tsx             # Dashboard UI, KPI Cards, Audit Table, PTP Modal
│   │   └── index.css           # Custom CSS design system
│   └── vite.config.ts          # Vite configuration & server proxy
├── tests/                      # Vitest test suite (20 passing unit tests)
│   ├── classifier.test.ts
│   ├── guardrails.test.ts
│   ├── policyEngine.test.ts
│   ├── llmSecurity.test.ts
│   └── metrics.test.ts
├── classification_rules.yaml  # Razorpay error reason lookup table
├── policy_rules.yaml          # Recovery policy decision rules
├── generate-synthetic-events.ts# Synthetic event generator (80/20 train/holdout split)
└── SPEC.md                    # System architecture specification
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v20.0.0 or higher
- **npm**: v9.0.0 or higher
- **API Keys**:
  - Google Gemini API Key (`GEMINI_API_KEY`)
  - Razorpay Test Mode Key & Secret (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`)

### 1. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/aditya-gg04/subscription-recovery-engine.git
cd subscription-recovery-engine
npm install
cd dashboard && npm install && cd ..
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# LLM API Keys
GEMINI_API_KEY=your_gemini_api_key
GROQ_API_KEY=your_groq_api_key

# Razorpay Test Mode Credentials
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_key_secret

# Global Flags (Set false to execute real Razorpay Test Mode API calls)
DRY_RUN=true
```

---

## ⚙️ Usage & Development Commands

### Running the Test Suite
Verify guardrails, classifier logic, policy engine, and LLM isolation:

```bash
npm test
```

### Generating Synthetic Data
Generate 100 deterministic subscription failure events (80 batch / 20 held-out split):

```bash
npm run generate-data
```

### Running Batch Recovery
Run the recovery engine over the synthetic event batch:

```bash
# Dry-run mode (network-free)
npm run run-batch

# Live mode (creates actual Razorpay Test Mode payment links)
DRY_RUN=false npm run run-batch
```

### Running the Express Backend & React Dashboard
Start both the backend server and Vite dev server:

```bash
# Terminal 1: Backend Server (Port 3001)
npm run server

# Terminal 2: Dashboard UI (Port 5173)
npm run dashboard:dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser to view the interactive dashboard.

---

## 🎥 Video Demonstration

Check out the full walkthrough covering dataset processing, guardrail enforcement, live Razorpay Payment Link creation, and the Promise-to-Pay voice recovery UI:

👉 **[Watch on YouTube: https://youtu.be/NsxGomrEi4E](https://youtu.be/NsxGomrEi4E)**

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
