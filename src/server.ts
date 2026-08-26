import express from 'express';
import cors from 'cors';
import { runLiveDemo } from './demoRunner.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get('/api/simulate', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const emit = (msg: string) => {
    // format for SSE:
    // chunk into lines, and send as data events
    const lines = msg.split('\n');
    for (const line of lines) {
      res.write(`data: ${line}\n\n`);
    }
    res.flushHeaders();
  };

  try {
    await runLiveDemo(emit);
    
    // Also copy the audit_log.jsonl to dashboard/public/audit_log.json so the dashboard can refresh
    try {
      const auditFilePath = path.resolve(__dirname, '../audit_log.jsonl');
      if (fs.existsSync(auditFilePath)) {
        const fileContents = fs.readFileSync(auditFilePath, 'utf8');
        const lines = fileContents.split('\n').filter(Boolean);
        const json = '[' + lines.join(',') + ']';
        const publicPath = path.resolve(__dirname, '../dashboard/public/audit_log.json');
        fs.writeFileSync(publicPath, json);
      }
    } catch (e) {
      console.error("Failed to update dashboard audit log json", e);
    }
    
    res.end();
  } catch (err: any) {
    emit(`\n❌ Error: ${err.message}`);
    res.end();
  }
});

app.post('/api/reply', async (req, res) => {
  try {
    const { eventId, message } = req.body;
    if (!eventId || !message) {
      return res.status(400).json({ error: 'Missing eventId or message' });
    }

    // Dynamic import to avoid circular deps if any
    const { askLLMToDetectPromiseToPay } = await import('./llmClient.js');
    const ptpResult = await askLLMToDetectPromiseToPay(message, new Date().toISOString());

    if (ptpResult.is_promise_to_pay && ptpResult.proposed_date_iso) {
      // Update audit log
      const auditFilePath = path.resolve(__dirname, '../audit_log.jsonl');
      if (fs.existsSync(auditFilePath)) {
        const fileContents = fs.readFileSync(auditFilePath, 'utf8');
        const lines = fileContents.split('\n').filter(Boolean);
        const newLines = lines.map(line => {
          const entry = JSON.parse(line);
          if (entry.event_id === eventId) {
            entry.policy_decision.retry_at = ptpResult.proposed_date_iso;
            entry.action_result.outcome = 'promise_to_pay_logged';
            entry.action_result.raw_api_response_ref = `Customer replied: "${message}". Retry rescheduled to ${ptpResult.proposed_date_iso}`;
          }
          return JSON.stringify(entry);
        });
        fs.writeFileSync(auditFilePath, newLines.join('\n') + '\n');
        
        // Also update the dashboard json
        const json = '[' + newLines.join(',') + ']';
        const publicPath = path.resolve(__dirname, '../dashboard/public/audit_log.json');
        fs.writeFileSync(publicPath, json);
      }
      return res.json({ success: true, ptp: ptpResult });
    } else {
      return res.json({ success: true, ptp: ptpResult });
    }
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Live Demo backend running on http://localhost:${PORT}`);
});
