import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { Diagnosis, RecoveryEvent, RootCauseCategory } from './schemas.js';
import { askLLMToClassify, askLLMForTimingHint } from './llmClient.js';

// Load deterministic mapping from classification_rules.yaml
interface RuleEntry {
  error_reason: string;
  category: RootCauseCategory;
  note: string;
}

interface ClassificationConfig {
  payment_method: string;
  rules?: RuleEntry[];
}

let rulesConfig: Record<string, RuleEntry[]> = {};
let configLoaded = false;

function loadConfig() {
  if (configLoaded) return;
  const configPath = path.resolve(__dirname, '../classification_rules.yaml');
  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    yaml.loadAll(fileContents, (doc: any) => {
      if (doc && doc.payment_method && doc.rules) {
        rulesConfig[doc.payment_method] = doc.rules;
      }
    });
    configLoaded = true;
  } catch (error) {
    console.error("Error loading classification_rules.yaml", error);
  }
}

export async function classifyEvent(event: RecoveryEvent): Promise<Diagnosis> {
  loadConfig();
  const methodRules = rulesConfig[event.payment_method] || [];
  const matchedRule = methodRules.find(r => r.error_reason === event.error_reason);

  if (matchedRule && matchedRule.category !== "ambiguous") {
    return {
      event_id: event.event_id,
      root_cause_category: matchedRule.category,
      root_cause_label: event.error_reason,
      confidence: 1.0,
      classification_method: "lookup_table",
      reasoning: matchedRule.note,
      suggested_timing_hint: null
    };
  }

  // T4.2: Route unmapped/ambiguous to LLM
  const llmResult = await askLLMToClassify(event);
  const timingHint = await askLLMForTimingHint(event); // T4.3: Timing hint

  return {
    event_id: event.event_id,
    root_cause_category: llmResult.root_cause_category,
    root_cause_label: event.error_reason,
    confidence: 0.8, // < 1.0 indicates model-classified
    classification_method: "llm",
    reasoning: llmResult.reasoning,
    suggested_timing_hint: timingHint
  };
}
