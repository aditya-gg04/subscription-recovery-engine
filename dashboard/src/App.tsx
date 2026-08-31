import React, { useEffect, useRef, useState } from 'react';
import { AuditLogEntry } from './types';
import { ShieldCheck, Zap, AlertTriangle, CheckCircle, Search, RefreshCw, X, ArrowUpRight, TrendingUp, Activity, Send, Mic } from 'lucide-react';

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

  // ── Live Demo Streaming ──────────────────────────────────────────────────
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [demoOutput, setDemoOutput] = useState<string[]>([]);
  const [demoRunning, setDemoRunning] = useState(false);

  // ── Promise-to-Pay Chat ──────────────────────────────────────────────────
  type ChatMessage = { role: 'agent' | 'customer' | 'system'; text: string };
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [ptpLoading, setPtpLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // Seed the chat with the agent's nudge message when an entry is selected
  useEffect(() => {
    if (selectedEntry) {
      const nudge = selectedEntry.action_result?.raw_api_response_ref;
      const seed: ChatMessage[] = [];
      // Show a synthetic agent message that looks like a WhatsApp nudge
      seed.push({
        role: 'agent',
        text: nudge && !nudge.toLowerCase().includes('error')
          ? nudge
          : `Namaste ${selectedEntry.event?.customer_name?.split(' ')[0] || 'ji'}! Aapka ₹${((selectedEntry.event?.amount || 0) / 100).toLocaleString('en-IN')} ka payment fail hua. Kya abhi retry kar sakte hain? 🙏`
      });
      setChatMessages(seed);
      setChatInput('');
    }
  }, [selectedEntry?.event_id]);

  const sendChatReply = async () => {
    if (!chatInput.trim() || !selectedEntry) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'customer', text: userMsg }]);
    setPtpLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: selectedEntry.event_id, message: userMsg })
      });
      const data = await res.json();
      if (data.ptp?.is_promise_to_pay && data.ptp?.proposed_date_iso) {
        const date = new Date(data.ptp.proposed_date_iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
        setChatMessages(prev => [...prev,
          { role: 'system', text: `🤝 Promise to Pay detected! Retry rescheduled to ${date}.` }
        ]);
        // Refresh logs to show the updated retry date
        setTimeout(fetchLogs, 800);
      } else {
        setChatMessages(prev => [...prev,
          { role: 'agent', text: 'Samajh gaye. Hum aapko ek reminder bhejenge. Koi bhi takleef ho to batayein! 🙏' }
        ]);
      }
    } catch {
      setChatMessages(prev => [...prev, { role: 'system', text: 'Error: Could not reach the AI backend.' }]);
    } finally {
      setPtpLoading(false);
    }
  };

  // ── Voice Simulation ─────────────────────────────────────────────────────
  const [isSpeaking, setIsSpeaking] = useState(false);

  const playVoiceSimulation = (text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    // Prefer a Hindi/Indian English voice if available
    const voices = window.speechSynthesis.getVoices();
    const hindiVoice = voices.find(v => v.lang.startsWith('hi') || v.lang.startsWith('en-IN'));
    if (hindiVoice) utter.voice = hindiVoice;
    utter.rate = 0.9;
    utter.pitch = 1.1;
    utter.onstart = () => setIsSpeaking(true);
    utter.onend = () => setIsSpeaking(false);
    utter.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utter);
  };

  const stopVoice = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const startLiveDemo = () => {
    setShowDemoModal(true);
    setDemoOutput([]);
    setDemoRunning(true);

    const es = new EventSource('http://localhost:3000/api/simulate');
    
    es.onmessage = (event) => {
      setDemoOutput(prev => [...prev, event.data]);
    };

    es.onerror = () => {
      es.close();
      setDemoRunning(false);
      // Wait a moment then refresh logs since a new one was appended
      setTimeout(fetchLogs, 1000);
    };
  };

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
  // 429-exhausted: still_failed due to Test Mode hard quota (labelled distinctly in raw_api_response_ref)
  const retryFailed429 = retryEvents.filter(l =>
    l.action_result?.outcome === 'still_failed' &&
    l.action_result?.raw_api_response_ref?.includes('429')
  );
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
          <ShieldCheck size={24} color="#0D94FB" />
          <h1>Razorpay Subscription Recovery Engine</h1>
          {hasLivePlinks
            ? <span className="badge badge-live">● Live mode</span>
            : <span className="badge badge-dry-run">● Dry run</span>
          }
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button onClick={startLiveDemo} className="btn-primary">
            <Zap size={14} /> Simulate live failure
          </button>
          <button onClick={fetchLogs} className="btn-secondary">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
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
          <div className="stat-value" style={{ color: 'var(--color-success)' }}>{grossRecoveryRate}%</div>
          <div className="stat-sub">₹{(totalRecovered / 100).toLocaleString('en-IN')} recovered of all ₹{(totalAttempted / 100).toLocaleString('en-IN')} attempted</div>
        </div>

        <div className="stat-card">
          <div className="stat-title">
            <Activity size={14} style={{ display: 'inline', marginRight: 4 }} />
            Retry Success Rate
          </div>
          <div className="stat-value" style={{ color: 'var(--color-accent)' }}>{retrySuccessRate}%</div>
          <div className="stat-sub">
            {retryRecovered.length}/{retryEvents.length} retries succeeded
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-title">Guardrail Enforcements</div>
          <div className="stat-value" style={{ color: 'var(--color-warning)' }}>
            {Object.values(guardrailTriggers).reduce((a: any, b: any) => a + b, 0)}
          </div>
          <div className="stat-sub">Automated safety overrides</div>
        </div>
      </div>

      {/* Test Mode quota notice — shown only when 429-exhausted failures exist in live mode */}
      {hasLivePlinks && retryFailed429.length > 0 && (
        <div className="info-banner">
          <strong>{retryFailed429.length} retry attempt{retryFailed429.length > 1 ? 's' : ''}</strong> returned <code>still_failed</code> because Razorpay <strong>Test Mode</strong> enforces a hard per-account payment-link quota — recovery code and backoff logic are correct; all failures are labelled <code>429 rate-limited after 3 attempts</code> in the audit log. In production (live keys) this quota does not apply.
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
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8125rem', fontWeight: 500 }}>{log.event_id}</td>
                  <td>{log.event?.customer_name}</td>
                  <td style={{ color: 'var(--color-muted)', fontSize: '0.8125rem' }}>{log.event?.error_reason}</td>
                  <td>
                    <span className={`status-tag tag-${log.diagnosis?.root_cause_category}`}>
                      {log.diagnosis?.root_cause_category?.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>{log.policy_decision?.rule_fired}</td>
                  <td>
                    <span className={`status-tag action-${log.policy_decision?.action_type}`}>
                      {log.policy_decision?.action_type?.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>
                    {log.policy_decision?.guardrail_triggered ? (
                      <span className="guardrail-badge">{log.policy_decision.guardrail_triggered}</span>
                    ) : (
                      <span style={{ color: 'var(--color-muted)' }}>—</span>
                    )}
                  </td>
                  <td>
                    {log.action_result?.api_call_id?.startsWith('plink_') ? (
                      <span className="plink-badge">
                        {log.action_result.api_call_id}
                      </span>
                    ) : log.action_result?.api_call_id ? (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                        {log.action_result.api_call_id}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-muted)' }}>—</span>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={() => setSelectedEntry(log)}
                      className="detail-btn"
                    >
                      <ArrowUpRight size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {filteredLogs.length > 30 && (
          <div className="result-count-bar">
            Showing 30 of {filteredLogs.length} results. Use the search box to filter.
          </div>
        )}
      </div>

      {/* Event Details Modal */}
      {selectedEntry && (
        <div className="modal-backdrop" onClick={() => { setSelectedEntry(null); stopVoice(); }}>
          <div className="modal-content" style={{ maxWidth: '700px' }} onClick={e => e.stopPropagation()}>
            <div className="panel-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                <ShieldCheck size={16} color="var(--color-accent)" />
                <span style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>{selectedEntry.event_id}</span>
              </h3>
              <button onClick={() => { setSelectedEntry(null); stopVoice(); }} className="modal-close-btn">
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1.25rem', display: 'grid', gap: '1rem', fontSize: '0.875rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-muted)', marginBottom: '0.2rem' }}>Customer</div>
                  <div style={{ color: 'var(--color-primary)' }}>{selectedEntry.event?.customer_name} <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--color-muted)' }}>({selectedEntry.event?.customer_id})</span></div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-muted)', marginBottom: '0.2rem' }}>Amount</div>
                  <div style={{ color: 'var(--color-primary)', fontWeight: 600 }}>₹{((selectedEntry.event?.amount || 0) / 100).toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-muted)', marginBottom: '0.2rem' }}>Error reason</div>
                  <div style={{ color: 'var(--color-primary)' }}>{selectedEntry.event?.error_reason}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-muted)', marginBottom: '0.2rem' }}>Payment method</div>
                  <div style={{ color: 'var(--color-primary)' }}>{selectedEntry.event?.payment_method}</div>
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)' }} />

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-muted)' }}>Diagnosis</span>
                <span className={`status-tag tag-${selectedEntry.diagnosis?.root_cause_category}`}>{selectedEntry.diagnosis?.root_cause_category?.replace('_',' ')}</span>
                <span style={{ color: 'var(--color-muted)', fontSize: '0.8125rem' }}>via <em>{selectedEntry.diagnosis?.classification_method}</em> · confidence: {selectedEntry.diagnosis?.confidence}</span>
              </div>
              <div style={{ color: 'var(--color-primary)', lineHeight: 1.5 }}>{selectedEntry.diagnosis?.reasoning}</div>
              {selectedEntry.diagnosis?.suggested_timing_hint && (
                <div style={{ color: 'var(--color-accent)', fontSize: '0.8125rem' }}>
                  ⏰ Salary-date timing hint: {selectedEntry.diagnosis.suggested_timing_hint}
                </div>
              )}

              <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)' }} />

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-muted)' }}>Policy decision</span>
                <code style={{ fontFamily: 'monospace', fontSize: '0.75rem', background: 'var(--color-bg-subtle)', padding: '0.125rem 0.375rem', borderRadius: '3px', color: 'var(--color-primary)' }}>{selectedEntry.policy_decision?.rule_fired}</code>
                <span style={{ color: 'var(--color-muted)' }}>→</span>
                <span className={`status-tag action-${selectedEntry.policy_decision?.action_type}`}>{selectedEntry.policy_decision?.action_type?.replace(/_/g,' ')}</span>
              </div>
              <div style={{ color: 'var(--color-muted)', fontSize: '0.8125rem' }}>Retry at: <span style={{ color: 'var(--color-primary)' }}>{selectedEntry.policy_decision?.retry_at || 'N/A'}</span></div>
              <div style={{ color: 'var(--color-primary)', lineHeight: 1.5 }}>{selectedEntry.policy_decision?.explanation}</div>
              {selectedEntry.policy_decision?.guardrail_triggered && (
                <div style={{ color: 'var(--color-warning)', fontWeight: 600, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  ⚠ Guardrail triggered: {selectedEntry.policy_decision.guardrail_triggered}
                </div>
              )}

              <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)' }} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-muted)', marginBottom: '0.2rem' }}>Outcome</div>
                  <span style={{ color: selectedEntry.action_result?.outcome === 'recovered' ? 'var(--color-success)' : selectedEntry.action_result?.outcome === 'still_failed' ? 'var(--color-critical)' : 'var(--color-muted)', fontWeight: 500 }}>
                    {selectedEntry.action_result?.outcome}
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-muted)', marginBottom: '0.2rem' }}>Amount recovered</div>
                  <div style={{ fontWeight: 600, color: 'var(--color-primary)' }}>₹{((selectedEntry.action_result?.amount_recovered || 0) / 100).toLocaleString('en-IN')}</div>
                </div>
              </div>

              {selectedEntry.action_result?.api_call_id?.startsWith('plink_') && (
                <div style={{ background: 'var(--tint-success-bg)', border: '1px solid #BBF7D0', borderRadius: '4px', padding: '0.875rem 1rem' }}>
                  <div style={{ fontWeight: 600, color: 'var(--color-primary)', marginBottom: '0.35rem' }}>Razorpay payment link created</div>
                  <code style={{ fontFamily: 'monospace', fontSize: '0.875rem', color: 'var(--tint-success-text)' }}>{selectedEntry.action_result.api_call_id}</code>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.25rem' }}>
                    Verify at: dashboard.razorpay.com/app/payment-links (Test Mode)
                  </div>
                </div>
              )}

              {/* ── Hinglish Voice Recovery ── */}
              <div style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem' }}>
                    <Mic size={14} color="var(--color-accent)" /> Hinglish voice recovery simulation
                  </span>
                  {isSpeaking ? (
                    <button onClick={stopVoice} style={{ background: 'var(--color-critical)', color: 'white', border: 'none', padding: '0.3rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontFamily: 'inherit' }}>
                      <div className="waveform-container" style={{ height: '14px' }}>
                        <div className="waveform-bar" /><div className="waveform-bar" /><div className="waveform-bar" /><div className="waveform-bar" /><div className="waveform-bar" />
                      </div>
                      Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => playVoiceSimulation(chatMessages[0]?.text || 'Namaste! Aapka payment fail hua hai. Please retry karein.')}
                      style={{ background: 'var(--color-accent)', color: 'white', border: 'none', padding: '0.3rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontFamily: 'inherit' }}
                    >
                      ▶ Play voice call
                    </button>
                  )}
                </div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', fontStyle: 'italic' }}>
                  "{chatMessages[0]?.text || 'Loading message...'}"
                </p>
              </div>

              {/* ── Promise-to-Pay Chat ── */}
              <div>
                <strong style={{ color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem', fontSize: '0.875rem' }}>
                  Promise-to-pay chat
                </strong>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>Simulate customer reply. Try: "Bhai salary 5 ko aayegi" 😊</p>

                <div className="chat-container">
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`chat-bubble ${msg.role === 'agent' ? 'outbound' : msg.role === 'customer' ? 'inbound' : 'system'}`}>
                      {msg.text}
                    </div>
                  ))}
                  {ptpLoading && (
                    <div className="chat-bubble system">🤖 AI is analyzing your reply...</div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="chat-input-row">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendChatReply()}
                    placeholder="Reply as customer (Hindi/English)..."
                    className="search-input"
                    style={{ flex: 1, width: 'auto' }}
                    disabled={ptpLoading}
                  />
                  <button
                    onClick={sendChatReply}
                    disabled={ptpLoading || !chatInput.trim()}
                    className="btn-primary"
                  >
                    <Send size={14} /> Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Live Demo Terminal Modal */}
      {showDemoModal && (
        <div className="modal-backdrop" style={{ zIndex: 999 }}>
          <div className="modal-content" style={{ width: '820px', maxWidth: '92%' }}>
            <div className="panel-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                <Activity size={16} className={demoRunning ? "pulsing-icon" : ""} color={demoRunning ? 'var(--color-success)' : 'var(--color-muted)'} />
                Live AI recovery stream
              </h3>
              <button onClick={() => setShowDemoModal(false)} disabled={demoRunning} className="modal-close-btn" style={{ opacity: demoRunning ? 0.35 : 1, cursor: demoRunning ? 'not-allowed' : 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            
            <div style={{ padding: '1.25rem' }}>
              <div style={{
                background: '#0F172A',
                color: '#4ADE80',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                padding: '1.25rem',
                borderRadius: '4px',
                height: '380px',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: '0.8125rem',
                lineHeight: '1.6'
              }}>
                {demoOutput.length === 0 ? 'Connecting to AI engine...' : demoOutput.join('\n')}
                {demoRunning && <span className="cursor-blink">_</span>}
              </div>
              {!demoRunning && demoOutput.length > 0 && (
                <div style={{ marginTop: '1rem', textAlign: 'right' }}>
                  <button onClick={() => { setShowDemoModal(false); fetchLogs(); }} className="btn-primary">
                    View in dashboard
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
