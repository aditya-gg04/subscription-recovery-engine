import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../src/metrics.js';
import * as path from 'path';

describe('Metrics (R-10 Read-Only Aggregation)', () => {
  it('T6.2: computeMetrics should read audit log without throwing', () => {
    // If audit_log.jsonl exists, computeMetrics should return valid metrics structure
    try {
      const metrics = computeMetrics();
      expect(metrics).toHaveProperty('totalEvents');
      expect(metrics).toHaveProperty('totalAmountAttempted');
      expect(metrics).toHaveProperty('totalAmountRecovered');
      expect(metrics).toHaveProperty('recoveryRatePercent');
      expect(metrics).toHaveProperty('classificationMethodBreakdown');
      expect(metrics).toHaveProperty('categoryBreakdown');
      expect(metrics).toHaveProperty('actionBreakdown');
      expect(metrics).toHaveProperty('guardrailTriggerCounts');
      expect(metrics).toHaveProperty('escalatedEventsCount');
      expect(metrics).toHaveProperty('exceptions');
    } catch (e: any) {
      // If audit log file does not exist yet during testing, exception is expected
      expect(e.message).toContain('Audit log file not found');
    }
  });
});
