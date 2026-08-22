import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { AuditLogEntry } from './schemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MetricsSummary {
  totalEvents: number;
  totalAmountAttempted: number;
  totalAmountRecovered: number;
  recoveryRatePercent: number;
  classificationMethodBreakdown: Record<string, number>;
  categoryBreakdown: Record<string, number>;
  actionBreakdown: Record<string, number>;
  guardrailTriggerCounts: Record<string, number>;
  escalatedEventsCount: number;
  exceptions: Array<{ event_id: string; reason: string; rule_fired: string }>;
}

export function computeMetrics(logFilePath?: string): MetricsSummary {
  const targetPath = logFilePath || path.resolve(__dirname, '../../audit_log.jsonl');
  
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Audit log file not found at ${targetPath}`);
  }

  const lines = fs.readFileSync(targetPath, 'utf8').trim().split('\n').filter(Boolean);
  const entries: AuditLogEntry[] = lines.map(line => JSON.parse(line));

  const metrics: MetricsSummary = {
    totalEvents: entries.length,
    totalAmountAttempted: 0,
    totalAmountRecovered: 0,
    recoveryRatePercent: 0,
    classificationMethodBreakdown: {},
    categoryBreakdown: {},
    actionBreakdown: {},
    guardrailTriggerCounts: {},
    escalatedEventsCount: 0,
    exceptions: []
  };

  for (const entry of entries) {
    if (!entry || !entry.event) continue;
    
    const event = entry.event;
    const diagnosis = entry.diagnosis;
    const decision = entry.policy_decision;
    const result = entry.action_result;

    // Amounts
    metrics.totalAmountAttempted += event.amount || 0;
    if (result && result.outcome === 'recovered') {
      metrics.totalAmountRecovered += result.amount_recovered || 0;
    }

    // Classification method breakdown
    if (diagnosis && diagnosis.classification_method) {
      const method = diagnosis.classification_method;
      metrics.classificationMethodBreakdown[method] = (metrics.classificationMethodBreakdown[method] || 0) + 1;
    }

    // Root cause category breakdown
    if (diagnosis && diagnosis.root_cause_category) {
      const category = diagnosis.root_cause_category;
      metrics.categoryBreakdown[category] = (metrics.categoryBreakdown[category] || 0) + 1;
    }

    // Action breakdown
    if (decision && decision.action_type) {
      const action = decision.action_type;
      metrics.actionBreakdown[action] = (metrics.actionBreakdown[action] || 0) + 1;
    }

    // Guardrail triggers
    if (decision && decision.guardrail_triggered) {
      const gr = decision.guardrail_triggered;
      metrics.guardrailTriggerCounts[gr] = (metrics.guardrailTriggerCounts[gr] || 0) + 1;
    }

    // Escalations / Exceptions
    if (decision && decision.action_type === 'escalate') {
      metrics.escalatedEventsCount++;
      metrics.exceptions.push({
        event_id: event.event_id,
        reason: event.error_reason,
        rule_fired: decision.rule_fired || 'UNKNOWN'
      });
    }
  }

  if (metrics.totalEvents > 0) {
    metrics.recoveryRatePercent = Number(((metrics.totalAmountRecovered / metrics.totalAmountAttempted) * 100).toFixed(2));
  }

  return metrics;
}

export function printMetricsReport(metrics: MetricsSummary, title = "SUBSCRIPTION RECOVERY METRICS REPORT"): void {
  console.log("\n==================================================");
  console.log(`         ${title}`);
  console.log("==================================================");
  console.log(`Total Events Processed:        ${metrics.totalEvents}`);
  console.log(`Total Amount Attempted:        ₹${(metrics.totalAmountAttempted / 100).toFixed(2)}`);
  console.log(`Total Amount Recovered:        ₹${(metrics.totalAmountRecovered / 100).toFixed(2)}`);
  console.log(`Recovery Rate (by Amount):     ${metrics.recoveryRatePercent}%`);
  console.log("--------------------------------------------------");
  console.log("Classification Method Breakdown:");
  for (const [method, count] of Object.entries(metrics.classificationMethodBreakdown)) {
    console.log(`  - ${method}: ${count}`);
  }
  console.log("--------------------------------------------------");
  console.log("Root Cause Category Breakdown:");
  for (const [cat, count] of Object.entries(metrics.categoryBreakdown)) {
    console.log(`  - ${cat}: ${count}`);
  }
  console.log("--------------------------------------------------");
  console.log("Action Type Breakdown:");
  for (const [act, count] of Object.entries(metrics.actionBreakdown)) {
    console.log(`  - ${act}: ${count}`);
  }
  console.log("--------------------------------------------------");
  console.log("Guardrails Triggered:");
  if (Object.keys(metrics.guardrailTriggerCounts).length === 0) {
    console.log("  - None triggered");
  } else {
    for (const [gr, count] of Object.entries(metrics.guardrailTriggerCounts)) {
      console.log(`  - ${gr}: ${count}`);
    }
  }
  console.log("--------------------------------------------------");
  console.log(`Escalated Events (${metrics.escalatedEventsCount}):`);
  metrics.exceptions.forEach(ex => {
    console.log(`  - Event ${ex.event_id} (${ex.reason}) -> Rule: ${ex.rule_fired}`);
  });
  console.log("==================================================\n");
}

// CLI Execution if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const summary = computeMetrics();
    printMetricsReport(summary);
  } catch (err: any) {
    console.error("Error generating metrics report:", err.message);
  }
}
