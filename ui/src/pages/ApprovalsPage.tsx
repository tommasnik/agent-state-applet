import { useState, useMemo, useCallback } from "react";
import { useApprovals } from "../hooks/useApprovals";
import type { Approval } from "../hooks/useApprovals";
import { useAgentsStore } from "../store/agents";

// ----------------------------------------------------------------
// Payload parsing — defensive, the agent controls the shape.
// Expected (best-effort): { proposedAction, uncertaintyReason, sources: [...] }
// ----------------------------------------------------------------

interface ApprovalSource {
  type?: string;
  label?: string;
  url?: string;
  text?: string;
}

interface ParsedPayload {
  proposedAction?: string;
  uncertaintyReason?: string;
  sources: ApprovalSource[];
  raw: string | null;
  /** true when payload was JSON we could read into known fields */
  structured: boolean;
}

function parsePayload(payload: string | null): ParsedPayload {
  if (!payload) {
    return { sources: [], raw: null, structured: false };
  }
  let obj: unknown;
  try {
    obj = JSON.parse(payload);
  } catch {
    return { sources: [], raw: payload, structured: false };
  }
  if (!obj || typeof obj !== "object") {
    return { sources: [], raw: payload, structured: false };
  }
  const o = obj as Record<string, unknown>;
  const proposedAction =
    typeof o["proposedAction"] === "string"
      ? (o["proposedAction"] as string)
      : typeof o["action"] === "string"
        ? (o["action"] as string)
        : undefined;
  const uncertaintyReason =
    typeof o["uncertaintyReason"] === "string"
      ? (o["uncertaintyReason"] as string)
      : typeof o["uncertainty"] === "string"
        ? (o["uncertainty"] as string)
        : typeof o["reason"] === "string"
          ? (o["reason"] as string)
          : undefined;
  const rawSources = Array.isArray(o["sources"]) ? (o["sources"] as unknown[]) : [];
  const sources: ApprovalSource[] = rawSources
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      type: typeof s["type"] === "string" ? (s["type"] as string) : undefined,
      label: typeof s["label"] === "string" ? (s["label"] as string) : undefined,
      url: typeof s["url"] === "string" ? (s["url"] as string) : undefined,
      text: typeof s["text"] === "string" ? (s["text"] as string) : undefined,
    }));
  const structured =
    proposedAction !== undefined ||
    uncertaintyReason !== undefined ||
    sources.length > 0;
  return {
    proposedAction,
    uncertaintyReason,
    sources,
    raw: payload,
    structured,
  };
}

function approvalSummary(a: Approval): string {
  const parsed = parsePayload(a.payload);
  if (parsed.proposedAction) return parsed.proposedAction;
  return `Approval #${a.id}`;
}

// ----------------------------------------------------------------
// Agent linking — correlate approval to a live agent by session_id.
// ----------------------------------------------------------------

function useLinkedAgentState(sessionId: string | null): string | null {
  const { agents } = useAgentsStore();
  return useMemo(() => {
    if (!sessionId) return null;
    const match = Object.values(agents).find((ag) => ag.session_id === sessionId);
    return match ? match.state : null;
  }, [agents, sessionId]);
}

// ----------------------------------------------------------------
// Source item
// ----------------------------------------------------------------

function SourceItem({ source, idx }: { source: ApprovalSource; idx: number }) {
  const label = source.label || source.url || source.text || source.type || `source ${idx + 1}`;
  return (
    <li className="approval-source" data-testid={`approval-source-${idx}`}>
      {source.type && <span className="approval-source-type">{source.type}</span>}
      {source.url ? (
        <a href={source.url} target="_blank" rel="noreferrer" className="approval-source-link">
          {label}
        </a>
      ) : (
        <span className="approval-source-text">{label}</span>
      )}
      {source.text && source.url && (
        <div className="approval-source-body">{source.text}</div>
      )}
    </li>
  );
}

// ----------------------------------------------------------------
// Detail panel
// ----------------------------------------------------------------

interface DetailProps {
  approval: Approval;
  onAnswered: (id: number) => void;
  onDismissed: (id: number) => void;
}

function ApprovalDetail({ approval, onAnswered, onDismissed }: DetailProps) {
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parsePayload(approval.payload), [approval.payload]);
  const linkedState = useLinkedAgentState(approval.session_id);

  const submitAnswer = useCallback(async () => {
    if (!answer.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${approval.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: answer.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onAnswered(approval.id);
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  }, [answer, submitting, approval.id, onAnswered]);

  const dismiss = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${approval.id}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onDismissed(approval.id);
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  }, [submitting, approval.id, onDismissed]);

  return (
    <div className="approval-detail" data-testid="approval-detail">
      <div className="approval-detail-head">
        <h2 className="approval-detail-title">{approvalSummary(approval)}</h2>
        <div className="approval-detail-badges">
          {(approval.session_id || approval.run_id != null) && (
            <span
              className="approval-agent-badge"
              data-testid="approval-agent-badge"
              title={
                approval.session_id
                  ? `session ${approval.session_id}`
                  : `run ${approval.run_id}`
              }
            >
              {linkedState === "waiting_for_approval" ? "● " : ""}
              {approval.session_id
                ? approval.session_id.slice(0, 8)
                : `run #${approval.run_id}`}
            </span>
          )}
        </div>
      </div>

      <section className="approval-section">
        <h3>Proposed action</h3>
        <p data-testid="approval-action">
          {parsed.proposedAction ?? <em>(not specified)</em>}
        </p>
      </section>

      <section className="approval-section">
        <h3>Why uncertain</h3>
        <p data-testid="approval-uncertainty">
          {parsed.uncertaintyReason ?? <em>(not specified)</em>}
        </p>
      </section>

      <section className="approval-section">
        <h3>Sources</h3>
        {parsed.sources.length > 0 ? (
          <ul className="approval-sources" data-testid="approval-sources">
            {parsed.sources.map((s, i) => (
              <SourceItem key={i} source={s} idx={i} />
            ))}
          </ul>
        ) : (
          <p className="empty-state">No sources provided.</p>
        )}
      </section>

      {!parsed.structured && parsed.raw && (
        <section className="approval-section">
          <h3>Raw payload</h3>
          <pre className="approval-raw" data-testid="approval-raw">
            {parsed.raw}
          </pre>
        </section>
      )}

      <section className="approval-section">
        <h3>Your answer</h3>
        <textarea
          className="approval-answer-input"
          data-testid="approval-answer-input"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Type your decision / instruction…"
          rows={3}
          disabled={submitting}
        />
        {error && <div className="approval-error" data-testid="approval-error">{error}</div>}
        <div className="approval-actions">
          <button
            className="approval-btn approval-btn--primary"
            data-testid="approval-submit"
            onClick={submitAnswer}
            disabled={submitting || !answer.trim()}
          >
            Send answer
          </button>
          <button
            className="approval-btn approval-btn--ghost"
            data-testid="approval-dismiss"
            onClick={dismiss}
            disabled={submitting}
          >
            Dismiss
          </button>
        </div>
      </section>
    </div>
  );
}

// ----------------------------------------------------------------
// Page
// ----------------------------------------------------------------

export function ApprovalsPage() {
  const { approvals, loading, removeLocal } = useApprovals();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selected = useMemo(
    () => approvals.find((a) => a.id === selectedId) ?? null,
    [approvals, selectedId]
  );

  // auto-select first item when nothing selected
  const effectiveSelected = selected ?? approvals[0] ?? null;

  const handleResolved = useCallback(
    (id: number) => {
      removeLocal(id);
      setSelectedId(null);
    },
    [removeLocal]
  );

  return (
    <div className="approvals-page page-content" style={{ padding: "16px 24px" }}>
      <div className="page-header">
        <h1>Approvals</h1>
        <span className="approvals-count" data-testid="approvals-count">
          {approvals.length} pending
        </span>
      </div>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : approvals.length === 0 ? (
        <p className="empty-state" data-testid="approvals-empty">
          No pending approvals.
        </p>
      ) : (
        <div className="approvals-layout">
          <ul className="approval-list" data-testid="approval-list">
            {approvals.map((a) => (
              <li key={a.id}>
                <button
                  className={
                    "approval-list-item" +
                    (effectiveSelected?.id === a.id ? " approval-list-item--active" : "")
                  }
                  data-testid={`approval-item-${a.id}`}
                  onClick={() => setSelectedId(a.id)}
                >
                  <span className="approval-list-title">{approvalSummary(a)}</span>
                  <span className="approval-list-meta">
                    {a.session_id ? a.session_id.slice(0, 8) : a.run_id != null ? `run #${a.run_id}` : `#${a.id}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {effectiveSelected && (
            <ApprovalDetail
              key={effectiveSelected.id}
              approval={effectiveSelected}
              onAnswered={handleResolved}
              onDismissed={handleResolved}
            />
          )}
        </div>
      )}
    </div>
  );
}
