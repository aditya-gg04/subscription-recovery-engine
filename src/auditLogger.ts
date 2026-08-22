import * as fs from 'fs';
import * as path from 'path';
import { AuditLogEntry } from './schemas.js';

/**
 * auditLogger.ts — Strictly append-only JSONL event writing.
 */

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Place the log in the project root
const logFilePath = path.resolve(__dirname, '../audit_log.jsonl');

export function logAuditEntry(entry: AuditLogEntry): void {
  // R-2: Append-only JSONL format
  const jsonlLine = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logFilePath, jsonlLine, { encoding: 'utf8' });
}
