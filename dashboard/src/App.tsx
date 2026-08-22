import React, { useEffect, useState } from 'react';
import { AuditLogEntry } from './types';
import { ShieldCheck, Zap, AlertTriangle, CheckCircle, Search, RefreshCw, X, ArrowUpRight } from 'lucide-react';

export default function App() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      // In production/dev, fetch audit_log.json from root or static API endpoint
      const res = await fetch('/audit_log.json');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      } else {
        // Fallback sample data if file isn't served directly by vite dev
        console.warn('audit_log.json not found directly, trying fallback endpoint');
      }
    } catch (e) {
      console.error('Failed to load audit log data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  // Compute Metrics
  const totalEvents = logs.length;
  const totalAttempted = logs.reduce((sum, l) => sum + (l.event?.amount || 0), 0);
  const totalRecovered = logs.reduce((sum, l) => sum + (l.action_result?.outcome === 'recovered' ? l.action_result?.amount_recovered || 0 : 0), 0);
  const recoveryRate = totalAttempted > 0 ? ((totalRecovered / totalAttempted) * 100).toFixed(1) : '0.0';

  const methodBreakdown = logs.reduce((acc: any, l) => {
    const m = l.diagnosis?.classification_method || 'unknown';
    acc[m] = (acc[m] || 0) + 1;
    return acc;
  }, {});

  const categoryBreakdown = logs.reduce((acc: any, l) => {
    const c = l.diagnosis?.root_cause_category || 'unknown';
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});

  const actionBreakdown = logs.reduce((acc: any, l) => {
    const a = l.policy_decision?.action_type || 'unknown';
    acc[a] = (acc[a] || 0) + 1;
    return acc;
  }, {});

  const guardrailTriggers = logs.reduce((acc: any, l) => {
    const g = l.policy_decision?.guardrail_triggered;
    if (g) acc[g] = (acc[g] || 0) + 1;
    return acc;
  }, {});

  const filteredLogs = logs.filter(l => 
    l.event_id?.toLowerCase().includes(search.toLowerCase()) ||
    l.event?.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
    l.event?.error_reason?.toLowerCase().includes(search.toLowerCase()) ||
    l.policy_decision?.rule_fired?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="dashboard-container">
      {/* Header */}
      <header>
        <div className="header-title">
          <ShieldCheck size={28} color="#3b82f6" />
          <h1>Razorpay Subscription Recovery Engine</h1>
          <span className="badge badge-dry-run">DRY RUN MODE</span>
        </div>
        <button onClick={fetchLogs} className="search-input" style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <RefreshCw size={14} /> Refresh Data
        </button>
      </header>

      {/* High-level KPI Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-title">Total Batch Events</div>
          <div className="stat-value">{totalEvents}</div>
          <div className="stat-sub">Processed end-to-end</div>
        </div>

        <div className="stat-card">
          <div className="stat-title">Total Amount Attempted</div>
          <div className="stat-value">₹{(totalAttempted / 100).toLocaleString('en-IN')}</div>
          <div className="stat-sub">Across all failed charges</div>
        </div>

        <div className="stat-card">
          <div className="stat-title">Total Recovered Amount</div>
          <div className="stat-value" style={{ color: '#10b981' }}>₹{(totalRecovered / 100).toLocaleString('en-IN')}</div>
          <div className="stat-sub">{recoveryRate}% Recovery Rate</div>
        </div>

        <div className="stat-card">
          <div className="stat-title">Guardrail Enforcements</div>
          <div className="stat-value" style={{ color: '#f59e0b' }}>
            {Object.values(guardrailTriggers).reduce((a: any, b: any) => a + b, 0)}
          </div>
          <div className="stat-sub">Automated safety overrides</div>
        </div>
      </div>

      {/* Breakdown Panels */}
      <div className="section-grid">
        {/* Classification Breakdown */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Root Cause Taxonomies</div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Classification Source</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="status-tag tag-soft">Soft Decline</span></td>
                <td>Lookup Table / Deterministic</td>
                <td>{categoryBreakdown['soft_decline'] || 0}</td>
              </tr>
              <tr>
                <td><span className="status-tag tag-hard">Hard Decline</span></td>
                <td>Lookup Table / Deterministic</td>
                <td>{categoryBreakdown['hard_decline'] || 0}</td>
              </tr>
              <tr>
                <td><span className="status-tag tag-ambiguous">Ambiguous</span></td>
                <td>LLM Classifier ({methodBreakdown['llm'] || 0} calls)</td>
                <td>{categoryBreakdown['ambiguous'] || 0}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Action Decision Breakdown */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Policy Decisions Fired</div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Action Type</th>
                <th>Count</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="status-tag action-retry">schedule_retry</span></td>
                <td>{actionBreakdown['schedule_retry'] || 0}</td>
                <td>24h/48h Backoff floor (G-2)</td>
              </tr>
              <tr>
                <td><span className="status-tag action-nudge">send_nudge</span></td>
                <td>{actionBreakdown['send_nudge'] || 0}</td>
                <td>Customer outreach message</td>
              </tr>
              <tr>
                <td><span className="status-tag action-escalate">escalate</span></td>
                <td>{actionBreakdown['escalate'] || 0}</td>
                <td>Severe hard decline or ambiguous cap</td>
              </tr>
              <tr>
                <td><span className="status-tag action-none">no_action</span></td>
                <td>{actionBreakdown['no_action'] || 0}</td>
                <td>Opted-out or retries exhausted</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Main Events Table */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Batch Event Audit Log</div>
          <div style={{ position: 'relative' }}>
            <input 
              type="text" 
              placeholder="Search ID, Name, Reason..." 
              value={search} 
              onChange={e => setSearch(e.target.value)}
              className="search-input"
            />
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading audit log...</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Event ID</th>
                <th>Customer</th>
                <th>Error Reason</th>
                <th>Category</th>
                <th>Policy Rule</th>
                <th>Action Taken</th>
                <th>Guardrail</th>
                <th>Drilldown</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.slice(0, 25).map(log => (
                <tr key={log.event_id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{log.event_id}</td>
                  <td>{log.event?.customer_name}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{log.event?.error_reason}</td>
                  <td>
                    <span className={`status-tag tag-${log.diagnosis?.root_cause_category}`}>
                      {log.diagnosis?.root_cause_category}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{log.policy_decision?.rule_fired}</td>
                  <td>
                    <span className={`status-tag action-${log.policy_decision?.action_type}`}>
                      {log.policy_decision?.action_type}
                    </span>
                  </td>
                  <td>
                    {log.policy_decision?.guardrail_triggered ? (
                      <span className="badge badge-dry-run">{log.policy_decision.guardrail_triggered}</span>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)' }}>-</span>
                    )}
                  </td>
                  <td>
                    <button 
                      onClick={() => setSelectedEntry(log)}
                      style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer' }}
                    >
                      <ArrowUpRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Event Details Modal */}
      {selectedEntry && (
        <div className="modal-backdrop" onClick={() => setSelectedEntry(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Audit Detail: {selectedEntry.event_id}</h3>
              <button onClick={() => setSelectedEntry(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gap: '1rem', fontSize: '0.875rem' }}>
              <div>
                <strong>Customer:</strong> {selectedEntry.event?.customer_name} ({selectedEntry.event?.customer_id})
              </div>
              <div>
                <strong>Error Reason:</strong> {selectedEntry.event?.error_reason} (Method: {selectedEntry.event?.payment_method})
              </div>
              <div>
                <strong>Diagnosis:</strong> {selectedEntry.diagnosis?.root_cause_category} via {selectedEntry.diagnosis?.classification_method} (Confidence: {selectedEntry.diagnosis?.confidence})
              </div>
              <div>
                <strong>Reasoning:</strong> {selectedEntry.diagnosis?.reasoning}
              </div>
              <div>
                <strong>Policy Decision:</strong> Rule {selectedEntry.policy_decision?.rule_fired} → {selectedEntry.policy_decision?.action_type}
              </div>
              <div>
                <strong>Explanation:</strong> {selectedEntry.policy_decision?.explanation}
              </div>
              {selectedEntry.policy_decision?.guardrail_triggered && (
                <div style={{ color: '#fbbf24', fontWeight: 600 }}>
                  Guardrail Triggered: {selectedEntry.policy_decision.guardrail_triggered}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
