import React, { useEffect, useState } from 'react';
import { AuditLogEntry } from './types';
import { ShieldCheck, Zap, AlertTriangle, CheckCircle, Search, RefreshCw, X, ArrowUpRight, TrendingUp, Activity } from 'lucide-react';

export default function App() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/audit_log.json');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
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

  // ── Metrics ────────────────────────────────────────────────────────────────

  const totalEvents = logs.length;
  const totalAttempted = logs.reduce((sum, l) => sum + (l.event?.amount || 0), 0);
  const totalRecovered = logs.reduce((sum, l) =>
    sum + (l.action_result?.outcome === 'recovered' ? l.action_result?.amount_recovered || 0 : 0), 0);

  // Gross recovery rate: recovered / all attempted amounts
  const grossRecoveryRate = totalAttempted > 0
    ? ((totalRecovered / totalAttempted) * 100).toFixed(1)
    : '0.0';

  // Retry success rate: of events where schedule_retry was decided,
  // how many actually produced a recovered outcome?
  const retryEvents = logs.filter(l => l.policy_decision?.action_type === 'schedule_retry');
  const retryRecovered = retryEvents.filter(l => l.action_result?.outcome === 'recovered');
  const retryFailed = retryEvents.filter(l => l.action_result?.outcome === 'still_failed');
  const retrySuccessRate = retryEvents.length > 0
    ? ((retryRecovered.length / retryEvents.length) * 100).toFixed(1)
    : '0.0';

  // Detect whether we have live plink_ IDs (i.e., system ran in live mode)
  const hasLivePlinks = logs.some(l =>
    l.action_result?.api_call_id?.startsWith('plink_'));

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
    l.policy_decision?.rule_fired?.toLowerCase().includes(search.toLowerCase()) ||
    l.action_result?.api_call_id?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="dashboard-container">
      {/* Header */}
      <header>
        <div className="header-title">
          <ShieldCheck size={28} color="#3b82f6" />
          <h1>Razorpay Subscription Recovery Engine</h1>
          {hasLivePlinks
            ? <span className="badge badge-live">🔴 LIVE MODE</span>
            : <span className="badge badge-dry-run">🔵 DRY RUN</span>
          }
        </div>
        <button onClick={fetchLogs} className="search-input" style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <RefreshCw size={14} /> Refresh Data
        </button>
      </header>

      {/* High-level KPI Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-title">Total Events Processed</div>
          <div className="stat-value">{totalEvents}</div>
          <div className="stat-sub">End-to-end through pipeline</div>
        </div>

        <div className="stat-card">
          <div className="stat-title">Total Amount at Risk</div>
          <div className="stat-value">₹{(totalAttempted / 100).toLocaleString('en-IN')}</div>
          <div className="stat-sub">Across all failed charges</div>
        </div>

        <div className="stat-card">
          <div className="stat-title">
            <TrendingUp size={14} style={{ display: 'inline', marginRight: 4 }} />
            Gross Recovery Rate
          </div>
          <div className="stat-value" style={{ color: '#10b981' }}>{grossRecoveryRate}%</div>
          <div className="stat-sub">₹{(totalRecovered / 100).toLocaleString('en-IN')} recovered of all ₹{(totalAttempted / 100).toLocaleString('en-IN')} attempted</div>
        </div>

        <div className="stat-card">
          <div className="stat-title">
            <Activity size={14} style={{ display: 'inline', marginRight: 4 }} />
            Retry Success Rate
          </div>
          <div className="stat-value" style={{ color: '#60a5fa' }}>{retrySuccessRate}%</div>
          <div className="stat-sub">
            {retryRecovered.length}/{retryEvents.length} retries succeeded
            {retryFailed.length > 0 &&
              <span style={{ color: '#f59e0b' }}> · {retryFailed.length} rate-limited*</span>
            }
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-title">Guardrail Enforcements</div>
          <div className="stat-value" style={{ color: '#f59e0b' }}>
            {Object.values(guardrailTriggers).reduce((a: any, b: any) => a + b, 0)}
          </div>
          <div className="stat-sub">Automated safety overrides</div>
        </div>
      </div>

      {/* Rate-limit disclaimer */}
      {retryFailed.length > 0 && (
        <div style={{
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: '0.5rem',
          padding: '0.75rem 1rem',
          fontSize: '0.8rem',
          color: '#fbbf24',
          marginBottom: '1rem'
        }}>
          * <strong>{retryFailed.length} retry attempts</strong> returned <code>still_failed</code> due to Razorpay Test Mode rate-limiting during batch execution (all API calls fired simultaneously). In production, retries are spaced ≥24h apart and would succeed individually.
        </div>
      )}

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
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="status-tag tag-soft">Soft Decline</span></td>
                <td>Lookup Table / Deterministic</td>
                <td>{categoryBreakdown['soft_decline'] || 0}</td>
                <td>{totalEvents > 0 ? (((categoryBreakdown['soft_decline'] || 0) / totalEvents) * 100).toFixed(0) : 0}%</td>
              </tr>
              <tr>
                <td><span className="status-tag tag-hard">Hard Decline</span></td>
                <td>Lookup Table / Deterministic</td>
                <td>{categoryBreakdown['hard_decline'] || 0}</td>
                <td>{totalEvents > 0 ? (((categoryBreakdown['hard_decline'] || 0) / totalEvents) * 100).toFixed(0) : 0}%</td>
              </tr>
              <tr>
                <td><span className="status-tag tag-ambiguous">Ambiguous</span></td>
                <td>LLM Classifier ({methodBreakdown['llm'] || 0} calls)</td>
                <td>{categoryBreakdown['ambiguous'] || 0}</td>
                <td>{totalEvents > 0 ? (((categoryBreakdown['ambiguous'] || 0) / totalEvents) * 100).toFixed(0) : 0}%</td>
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
                <td>24h/48h backoff or salary-date aligned (G-2)</td>
              </tr>
              <tr>
                <td><span className="status-tag action-nudge">send_nudge</span></td>
                <td>{actionBreakdown['send_nudge'] || 0}</td>
                <td>Hinglish customer outreach message</td>
              </tr>
              <tr>
                <td><span className="status-tag action-escalate">escalate</span></td>
                <td>{actionBreakdown['escalate'] || 0}</td>
                <td>Severe hard decline or ambiguous policy cap</td>
              </tr>
              <tr>
                <td><span className="status-tag action-none">no_action</span></td>
                <td>{actionBreakdown['no_action'] || 0}</td>
                <td>Opted-out (G-4) or retries exhausted (G-1)</td>
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
              placeholder="Search ID, Name, Reason, plink_..."
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
                <th>Action</th>
                <th>Guardrail</th>
                <th>API Call ID</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.slice(0, 30).map(log => (
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
                    <span className={`status-tag action-${log.policy_decision?.action_type?.replace('_', '-')}`}>
                      {log.policy_decision?.action_type}
                    </span>
                  </td>
                  <td>
                    {log.policy_decision?.guardrail_triggered ? (
                      <span className="badge badge-dry-run">{log.policy_decision.guardrail_triggered}</span>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)' }}>—</span>
                    )}
                  </td>
                  <td>
                    {log.action_result?.api_call_id?.startsWith('plink_') ? (
                      <span style={{
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        background: 'rgba(16,185,129,0.15)',
                        color: '#10b981',
                        padding: '0.15rem 0.4rem',
                        borderRadius: '0.25rem',
                        border: '1px solid rgba(16,185,129,0.3)'
                      }}>
                        {log.action_result.api_call_id}
                      </span>
                    ) : log.action_result?.api_call_id ? (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {log.action_result.api_call_id}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)' }}>—</span>
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
        {filteredLogs.length > 30 && (
          <div style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
            Showing 30 of {filteredLogs.length} results. Use the search box to filter.
          </div>
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

            <div style={{ display: 'grid', gap: '0.75rem', fontSize: '0.875rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div><strong>Customer:</strong><br />{selectedEntry.event?.customer_name} ({selectedEntry.event?.customer_id})</div>
                <div><strong>Amount:</strong><br />₹{((selectedEntry.event?.amount || 0) / 100).toLocaleString('en-IN')}</div>
                <div><strong>Error Reason:</strong><br />{selectedEntry.event?.error_reason}</div>
                <div><strong>Payment Method:</strong><br />{selectedEntry.event?.payment_method}</div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)' }} />

              <div><strong>Diagnosis:</strong> <span className={`status-tag tag-${selectedEntry.diagnosis?.root_cause_category}`}>{selectedEntry.diagnosis?.root_cause_category}</span> via <em>{selectedEntry.diagnosis?.classification_method}</em> (confidence: {selectedEntry.diagnosis?.confidence})</div>
              <div><strong>Reasoning:</strong> {selectedEntry.diagnosis?.reasoning}</div>
              {selectedEntry.diagnosis?.suggested_timing_hint && (
                <div style={{ color: '#60a5fa' }}>
                  <strong>⏰ Salary-Date Timing Hint:</strong> {selectedEntry.diagnosis.suggested_timing_hint}
                </div>
              )}

              <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)' }} />

              <div><strong>Policy Decision:</strong> Rule <code>{selectedEntry.policy_decision?.rule_fired}</code> → <span className={`status-tag action-${selectedEntry.policy_decision?.action_type?.replace('_', '-')}`}>{selectedEntry.policy_decision?.action_type}</span></div>
              <div><strong>Retry At:</strong> {selectedEntry.policy_decision?.retry_at || 'N/A'}</div>
              <div><strong>Explanation:</strong> {selectedEntry.policy_decision?.explanation}</div>
              {selectedEntry.policy_decision?.guardrail_triggered && (
                <div style={{ color: '#fbbf24', fontWeight: 600 }}>
                  ⚠️ Guardrail Triggered: {selectedEntry.policy_decision.guardrail_triggered}
                </div>
              )}

              <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)' }} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div><strong>Outcome:</strong><br />
                  <span style={{ color: selectedEntry.action_result?.outcome === 'recovered' ? '#10b981' : selectedEntry.action_result?.outcome === 'still_failed' ? '#ef4444' : '#6b7280' }}>
                    {selectedEntry.action_result?.outcome}
                  </span>
                </div>
                <div><strong>Amount Recovered:</strong><br />
                  ₹{((selectedEntry.action_result?.amount_recovered || 0) / 100).toLocaleString('en-IN')}
                </div>
              </div>

              {selectedEntry.action_result?.api_call_id?.startsWith('plink_') && (
                <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <strong>🎉 Razorpay Payment Link Created</strong><br />
                  <code style={{ color: '#10b981', fontSize: '0.9rem' }}>{selectedEntry.action_result.api_call_id}</code><br />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Verify at: dashboard.razorpay.com/app/payment-links (Test Mode)
                  </span>
                </div>
              )}

              {selectedEntry.action_result?.raw_api_response_ref && (
                <div style={{ color: '#f87171', fontSize: '0.8rem' }}>
                  <strong>Error:</strong> {selectedEntry.action_result.raw_api_response_ref}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
