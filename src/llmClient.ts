import { GoogleGenerativeAI } from '@google/generative-ai';
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
 */

const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_gemini');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy_groq' });

export interface ClassificationResult {
  root_cause_category: RootCauseCategory;
  reasoning: string;
}

// Tool schemas
const classifyFailureTool = {
  name: "classify_failure",
  description: "Classifies a failed payment event based on the error reason and other details.",
  parameters: {
    type: "OBJECT",
    properties: {
      category: {
        type: "STRING",
        description: "Must be one of: 'soft_decline', 'hard_decline', 'ambiguous'.",
        enum: ["soft_decline", "hard_decline", "ambiguous"]
      },
      reasoning: {
        type: "STRING",
        description: "Reasoning for the classification."
      }
    },
    required: ["category", "reasoning"]
  }
};

const suggestRetryTimingTool = {
  name: "suggest_retry_timing",
  description: "Suggests the best timing to retry a payment based on the error.",
  parameters: {
    type: "OBJECT",
    properties: {
      timing_hint: {
        type: "STRING",
        description: "The suggested timing hint (e.g. 'Retry around salary day')."
      }
    },
    required: ["timing_hint"]
  }
};

const generateRecoveryMessageTool = {
  name: "generate_recovery_message",
  description: "Generates an outbound message to a customer about their failed payment.",
  parameters: {
    type: "OBJECT",
    properties: {
      message_text: {
        type: "STRING",
        description: "The recovery message content to send."
      }
    },
    required: ["message_text"]
  }
};

export async function askLLMToClassify(event: RecoveryEvent): Promise<ClassificationResult> {
  const prompt = `Analyze this payment failure and classify it into soft_decline, hard_decline, or ambiguous:
Event ID: ${event.event_id}
Reason: ${event.error_reason}
Source: ${event.error_source}
Amount: ${event.amount}
Method: ${event.payment_method}`;

  // Try Gemini first
  try {
    const model = gemini.getGenerativeModel({
      model: 'gemini-1.5-flash',
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
    console.warn("Gemini classification failed, falling back to Groq...", error);
  }

  // Fallback to Groq
  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant',
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
  } catch (error) {
    console.warn("Groq classification also failed.", error);
  }

  // Fallback if both fail
  return {
    root_cause_category: "ambiguous",
    reasoning: "LLM classification failed on both primary and fallback."
  };
}

export async function askLLMForTimingHint(event: RecoveryEvent): Promise<string | null> {
  // Try Gemini
  try {
    const model = gemini.getGenerativeModel({
      model: 'gemini-1.5-flash',
      tools: [{ functionDeclarations: [suggestRetryTimingTool] }]
    });
    const prompt = `Suggest a retry timing hint for failure: ${event.error_reason}`;
    const response = await model.generateContent(prompt);
    const call = response.response.functionCalls()?.[0];
    if (call && call.name === 'suggest_retry_timing') {
      const args = call.args as any;
      return args.timing_hint;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

export async function askLLMToGenerateMessage(event: RecoveryEvent): Promise<string | null> {
  // Try Gemini
  try {
    const model = gemini.getGenerativeModel({
      model: 'gemini-1.5-flash',
      tools: [{ functionDeclarations: [generateRecoveryMessageTool] }]
    });
    const prompt = `Generate a polite recovery message for user ${event.customer_name} whose ${event.payment_method} payment failed due to ${event.error_reason}.`;
    const response = await model.generateContent(prompt);
    const call = response.response.functionCalls()?.[0];
    if (call && call.name === 'generate_recovery_message') {
      const args = call.args as any;
      return args.message_text;
    }
  } catch (e) {
    // ignore
  }
  return null;
}
