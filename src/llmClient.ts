import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { RecoveryEvent, RootCauseCategory } from './schemas.js';

/**
 * llmClient.ts — LLM integration layer.
 *
 * Gemini primary, Groq fallback.
 * Exposes exactly 3 tools per R-8:
 *   - classify_failure
 *   - generate_recovery_message
 *   - suggest_retry_timing
 *
 * Enhancement notes:
 *  - Groq model updated to llama-3.3-70b-versatile (mixtral-8x7b-32768 deprecated)
 *  - suggest_retry_timing now reasons about salary-credit dates for insufficient_funds
 *  - generate_recovery_message produces warm Hinglish messages with subscription context
 */

const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_gemini');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy_groq' });

// Active Groq model — mixtral-8x7b-32768 was deprecated; llama-3.3-70b-versatile is current.
const GROQ_MODEL = 'llama-3.3-70b-versatile';

export interface ClassificationResult {
  root_cause_category: RootCauseCategory;
  reasoning: string;
}

// Tool schemas
const classifyFailureTool = {
  name: "classify_failure",
  description: "Classifies a failed payment event based on the error reason and other details into exactly one of: soft_decline (transient, instrument still valid, retry can succeed), hard_decline (instrument invalid/blocked, retry will not help), or ambiguous (insufficient info to determine without more context).",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      category: {
        type: SchemaType.STRING,
        description: "Must be one of: 'soft_decline', 'hard_decline', 'ambiguous'.",
        enum: ["soft_decline", "hard_decline", "ambiguous"]
      },
      reasoning: {
        type: SchemaType.STRING,
        description: "Concise reasoning for the classification (1-2 sentences)."
      }
    },
    required: ["category", "reasoning"]
  }
};

const suggestRetryTimingTool = {
  name: "suggest_retry_timing",
  description: "Suggests the optimal ISO 8601 timestamp to retry a payment. For insufficient_funds, consider that salaried customers in India typically receive salary between the 25th–1st of each month. Return an ISO timestamp that falls near the next expected salary credit.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      retry_at_iso: {
        type: SchemaType.STRING,
        description: "ISO 8601 UTC timestamp for the recommended retry. Must be at least 24 hours after event_timestamp (G-2 floor). Example: '2026-08-26T04:30:00.000Z'"
      },
      timing_rationale: {
        type: SchemaType.STRING,
        description: "One-sentence explanation of why this timing was chosen."
      }
    },
    required: ["retry_at_iso", "timing_rationale"]
  }
};

const generateRecoveryMessageTool = {
  name: "generate_recovery_message",
  description: "Generates a warm, conversational outbound recovery message for a customer whose payment failed. Produce the message in Hinglish (a natural mix of Hindi and English as used in everyday Indian communication). Keep it friendly, not alarming, and action-oriented.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      message_text: {
        type: SchemaType.STRING,
        description: "The recovery message content to send to the customer. Should be in Hinglish, 2-3 sentences, warm and helpful."
      }
    },
    required: ["message_text"]
  }
};

export async function askLLMToClassify(event: RecoveryEvent): Promise<ClassificationResult> {
  const prompt = `You are a payments classification expert for an Indian fintech company. Classify this payment failure into exactly one category.

Event details:
- Event ID: ${event.event_id}
- Error reason: ${event.error_reason}
- Error source: ${event.error_source}
- Error step: ${event.error_step}
- Payment method: ${event.payment_method}
- Amount: ₹${(event.amount / 100).toFixed(2)}
- Attempt number: ${event.attempt_number}

Rules:
- soft_decline: Failure is transient (timeout, bank downtime, temp limit, customer backed out). The instrument itself is valid. Retrying later has a reasonable chance of success.
- hard_decline: The instrument is definitively invalid or blocked (expired card, CVV error, account blocked). Retrying the same request cannot succeed without customer action.
- ambiguous: Genuinely unclear from the above info — e.g. "payment_failed" with no further detail, or "authentication_failed" which could be either.

Call the classify_failure tool with your answer.`;

  // Try Gemini first
  try {
    const model = gemini.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: [{ functionDeclarations: [classifyFailureTool] }]
    });

    const response = await model.generateContent(prompt);
    const call = response.response.functionCalls()?.[0];
    if (call && call.name === 'classify_failure') {
      const args = call.args as any;
      return {
        root_cause_category: args.category as RootCauseCategory,
        reasoning: args.reasoning
      };
    }
  } catch (error) {
    console.warn(`[LLM] Gemini classification failed for ${event.event_id}, trying Groq...`);
  }

  // Fallback to Groq
  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: GROQ_MODEL,
      tools: [{
        type: 'function',
        function: {
          name: classifyFailureTool.name,
          description: classifyFailureTool.description,
          parameters: classifyFailureTool.parameters as any
        }
      }],
      tool_choice: { type: 'function', function: { name: 'classify_failure' } }
    });

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
    if (toolCall && toolCall.function.name === 'classify_failure') {
      const args = JSON.parse(toolCall.function.arguments);
      return {
        root_cause_category: args.category as RootCauseCategory,
        reasoning: args.reasoning
      };
    }
  } catch (error: any) {
    console.warn(`[LLM] Groq classification also failed for ${event.event_id}:`, error?.message);
  }

  return {
    root_cause_category: "ambiguous",
    reasoning: "Both Gemini and Groq classification failed — defaulting to ambiguous for safe escalation."
  };
}

export async function askLLMForTimingHint(event: RecoveryEvent): Promise<string | null> {
  // Only invoke timing intelligence for reasons where timing actually matters
  const timingSensitiveReasons = ['insufficient_funds', 'transaction_limit_exceeded'];
  if (!timingSensitiveReasons.includes(event.error_reason)) {
    return null;
  }

  const today = new Date(event.event_timestamp);
  const day = today.getUTCDate();

  const prompt = `You are a payments timing expert for Indian subscription businesses.

A customer's subscription payment failed due to: ${event.error_reason}
Current date (UTC): ${event.event_timestamp}
Current day of month: ${day}

Indian salary patterns:
- Government employees: paid on the 1st of each month
- Private sector: typically paid between the 25th and 1st of the month
- Day laborers / weekly earners: paid every Friday

Based on the current date (day ${day}), determine the optimal ISO 8601 UTC timestamp to retry this payment to maximize success probability — ideally the day after the next salary credit.

IMPORTANT: The retry_at timestamp MUST be at least 24 hours after ${event.event_timestamp} (this is a hard floor).

Call the suggest_retry_timing tool with your answer.`;

  // Try Gemini first
  try {
    const model = gemini.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: [{ functionDeclarations: [suggestRetryTimingTool] }]
    });
    const response = await model.generateContent(prompt);
    const call = response.response.functionCalls()?.[0];
    if (call && call.name === 'suggest_retry_timing') {
      const args = call.args as any;
      // Validate: must be a valid ISO string and at least 24h after event
      const suggestedDate = new Date(args.retry_at_iso);
      const minDate = new Date(new Date(event.event_timestamp).getTime() + 24 * 60 * 60 * 1000);
      if (!isNaN(suggestedDate.getTime()) && suggestedDate >= minDate) {
        console.log(`[LLM] Timing hint for ${event.event_id} (${event.error_reason}): ${args.retry_at_iso} — ${args.timing_rationale}`);
        return args.retry_at_iso;
      }
    }
  } catch (e) {
    // fall through to Groq
  }

  // Fallback to Groq
  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: GROQ_MODEL,
      tools: [{
        type: 'function',
        function: {
          name: suggestRetryTimingTool.name,
          description: suggestRetryTimingTool.description,
          parameters: suggestRetryTimingTool.parameters as any
        }
      }],
      tool_choice: { type: 'function', function: { name: 'suggest_retry_timing' } }
    });
    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
    if (toolCall && toolCall.function.name === 'suggest_retry_timing') {
      const args = JSON.parse(toolCall.function.arguments);
      const suggestedDate = new Date(args.retry_at_iso);
      const minDate = new Date(new Date(event.event_timestamp).getTime() + 24 * 60 * 60 * 1000);
      if (!isNaN(suggestedDate.getTime()) && suggestedDate >= minDate) {
        console.log(`[LLM/Groq] Timing hint for ${event.event_id}: ${args.retry_at_iso} — ${args.timing_rationale}`);
        return args.retry_at_iso;
      }
    }
  } catch (e) {
    // ignore
  }

  return null;
}

export async function askLLMToGenerateMessage(event: RecoveryEvent): Promise<string | null> {
  const amountRs = (event.amount / 100).toFixed(0);
  const prompt = `You are writing a friendly recovery message for an Indian customer whose subscription payment failed.

Customer name: ${event.customer_name}
Payment method: ${event.payment_method}
Amount: ₹${amountRs}
Failure reason: ${event.error_reason}
Attempt number: ${event.attempt_number}

Write a warm, helpful message in Hinglish (natural mix of Hindi and English, like everyday Indian messaging — e.g. "Aapka payment process nahi ho paya"). 
- Do NOT be alarming or formal.
- Keep it to 2-3 sentences.
- Include a clear action the customer should take.
- Do NOT mention internal error codes.
- Sound like a helpful friend from the company, not a robot.

Call the generate_recovery_message tool with your message.`;

  // Try Gemini first
  try {
    const model = gemini.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: [{ functionDeclarations: [generateRecoveryMessageTool] }]
    });
    const response = await model.generateContent(prompt);
    const call = response.response.functionCalls()?.[0];
    if (call && call.name === 'generate_recovery_message') {
      const args = call.args as any;
      return args.message_text;
    }
  } catch (e) {
    // fall through to Groq
  }

  // Fallback to Groq
  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: GROQ_MODEL,
      tools: [{
        type: 'function',
        function: {
          name: generateRecoveryMessageTool.name,
          description: generateRecoveryMessageTool.description,
          parameters: generateRecoveryMessageTool.parameters as any
        }
      }],
      tool_choice: { type: 'function', function: { name: 'generate_recovery_message' } }
    });
    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
    if (toolCall && toolCall.function.name === 'generate_recovery_message') {
      const args = JSON.parse(toolCall.function.arguments);
      return args.message_text;
    }
  } catch (e) {
    // ignore
  }

  return null;
}
