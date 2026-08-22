import 'dotenv/config'; // Loads .env
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { RecoveryEvent, AuditLogEntry } from './src/schemas.js';
import { classifyEvent } from './src/classifier.js';
import { evaluatePolicy } from './src/policyEngine.js';
import { executeAction, CONFIG } from './src/actionExecutor.js';
import { logAuditEntry } from './src/auditLogger.js';
import { askLLMToGenerateMessage } from './src/llmClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const inputFileArg = process.argv[2] || 'synthetic_events.json';
  const shouldAppend = process.argv.includes('--append');
  
  console.log(`Starting Batch Run... DRY_RUN is ${CONFIG.DRY_RUN}`);
  console.log(`Input File: ${inputFileArg}`);

  const inputFilePath = path.resolve(__dirname, inputFileArg);
  const auditFilePath = path.resolve(__dirname, 'audit_log.jsonl');

  if (!shouldAppend && fs.existsSync(auditFilePath)) {
    console.log('Clearing old audit log for fresh batch run...');
    fs.unlinkSync(auditFilePath);
  }

  const fileContents = fs.readFileSync(inputFilePath, 'utf8');
  const events: RecoveryEvent[] = JSON.parse(fileContents);
  
  console.log(`Loaded ${events.length} events from ${inputFileArg}.`);

  for (const event of events) {
    try {
      console.log(`Processing event: ${event.event_id}`);
      
      // 1. Classifier
      const diagnosis = await classifyEvent(event);
      
      // 2. Policy Engine
      const decision = evaluatePolicy(diagnosis, event);
      
      // (Optional) Generate message if sending nudge
      let messagePayload = null;
      if (decision.action_type === 'send_nudge' || decision.action_type === 'escalate') {
        messagePayload = await askLLMToGenerateMessage(event);
      }

      // 3. Action Executor
      const result = await executeAction(decision, event, messagePayload);

      // 4. Audit Logger
      const logEntry: AuditLogEntry = {
        event_id: event.event_id,
        event,
        diagnosis,
        policy_decision: decision,
        action_result: result,
        pipeline_version: "1.0.0",
        logged_at: new Date().toISOString()
      };
      
      logAuditEntry(logEntry);
    } catch (err: any) {
      console.error(`Error processing event ${event.event_id}:`, err);
    }
  }

  console.log('Batch run complete! Results written to audit_log.jsonl.');
}

run().catch(console.error);
