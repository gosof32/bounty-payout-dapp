import React, { useState } from "react";
import { EXPLORER_BASE } from "../config.js";
import Icon from "./Icons.jsx";

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

const STEPS = ["signing", "submitted", "accepted", "finalized"];
const STEP_LABEL = {
  signing: "Sign in wallet",
  submitted: "Submitted",
  accepted: "Accepted by validators",
  finalized: "Finalized",
};

export function TxItem({ tx, onDismiss }) {
  const failed = tx.phase === "error";
  const reached = failed ? STEPS.indexOf(tx.lastPhase ?? "signing") : STEPS.indexOf(tx.phase);
  const done = failed || tx.phase === "finalized";
  return (
    <li className={`tx ${failed ? "tx-error" : tx.phase === "finalized" ? "tx-ok" : "tx-pending"}`} data-phase={tx.phase}>
      <div className="tx-head">
        <span className="tx-icon" aria-hidden="true">
          {failed ? <Icon name="x" size={14} strokeWidth={2.6} /> : tx.phase === "finalized" ? <Icon name="check" size={14} strokeWidth={2.6} /> : <span className="spinner" />}
        </span>
        <strong className="tx-label">{tx.label}</strong>
        {done && onDismiss && (
          <button type="button" className="icon-btn" onClick={() => onDismiss(tx.id)} aria-label="Dismiss transaction">
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i < reached || (i === reached && !failed && tx.phase === "finalized") ? "done" : i === reached ? (failed ? "fail" : "now") : ""}>
            <span className="step-dot" aria-hidden="true" />
            <span className="step-label">{STEP_LABEL[s]}</span>
          </li>
        ))}
      </ol>
      {failed && <p className="tx-msg" role="alert">{tx.message}</p>}
      {tx.phase === "finalized" && (tx.summary || tx.result?.returnValue) && <p className="tx-msg">Result: {tx.summary ?? tx.result.returnValue}</p>}
      {tx.phase !== "finalized" && !failed && tx.hash && <p className="tx-msg muted">Waiting for validators… this can take a minute, longer for a judge call.</p>}
      {tx.hash && (
        <a className="tx-hash" href={`${EXPLORER_BASE}/tx/${tx.hash}`} target="_blank" rel="noreferrer">{short(tx.hash)}</a>
      )}
    </li>
  );
}

// Transactions as a docked toast stack with a step tracker per transaction.
export default function TxLog({ txs }) {
  const [hidden, setHidden] = useState(() => new Set());
  const [collapsed, setCollapsed] = useState(false);
  const visible = txs.filter((t) => !hidden.has(t.id));
  if (!visible.length) return null;
  const pending = visible.filter((t) => t.phase !== "finalized" && t.phase !== "error").length;
  const dismiss = (id) => setHidden((h) => new Set(h).add(id));

  return (
    <section className={`txlog ${collapsed ? "collapsed" : ""}`} aria-label="Transactions">
      <header className="txlog-head">
        <h3>
          {pending > 0 ? <span className="spinner" aria-hidden="true" /> : <Icon name="check" size={15} />}
          Your transactions <span className="count-pill">{visible.length}</span>
        </h3>
        <button type="button" className="icon-btn" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} aria-label={collapsed ? "Expand transactions" : "Collapse transactions"}>
          <Icon name={collapsed ? "chevronUp" : "chevronDown"} size={16} />
        </button>
      </header>
      {!collapsed && (
        <div className="txlog-body">
          <p className="muted small">A transaction counts only once it is FINALIZED with validator agreement.</p>
          <ul>{visible.map((t) => <TxItem key={t.id} tx={t} onDismiss={dismiss} />)}</ul>
        </div>
      )}
    </section>
  );
}
