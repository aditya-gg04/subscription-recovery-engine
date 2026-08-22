import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { Diagnosis, RecoveryEvent, RootCauseCategory } from './schemas';

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
  const configPath = path.resolve(__dirname, '../../classification_rules.yaml');
  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    // js-yaml loadAll handles multiple documents separated by ---
    yaml.loadAll(fileContents, (doc: any) => {
      if (doc && doc.payment_method && doc.rules) {
        rulesConfig[doc.payment_method] = doc.rules;
      }
    });
    configLoaded = true;
  } catch (error) {
    console.error("Error loading classification_rules.yaml", error);
    // In production, we'd probably throw, but let's just swallow for now
  }
}

export function classifyEvent(event: RecoveryEvent): Diagnosis {
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

  // T3.1: Only implementing deterministic path right now.
  // We throw if ambiguous or unmapped. Day 4 will route to LLM.
  if (matchedRule && matchedRule.category === "ambiguous") {
    // For now we will return ambiguous with 1.0 confidence as a placeholder
    // until T4.2 is implemented, or throw. Let's return the ambiguous category for now.
    return {
      event_id: event.event_id,
      root_cause_category: "ambiguous",
      root_cause_label: event.error_reason,
      confidence: 1.0, // Will be < 1.0 when LLM does it
      classification_method: "lookup_table",
      reasoning: matchedRule.note,
      suggested_timing_hint: null
    };
  }

  throw new Error(`Unmapped error_reason: ${event.error_reason} for method: ${event.payment_method}`);
}
