import React from "react";
import { EXPLORER_BASE } from "../config.js";

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

const STEPS = ["signing", "submitted", "accepted", "finalized"];
const STEP_LABEL = {
  signing: "Sign in wallet",
  submitted: "Submitted",
  accepted: "Accepted by validators",
  finalized: "Finalized",
};

export function TxItem({ tx }) {
  const failed = tx.phase === "error";
  const reached = failed ? STEPS.indexOf(tx.lastPhase ?? "signing") : STEPS.indexOf(tx.phase);
  return (
    <li className={`tx ${failed ? "tx-error" : tx.phase === "finalized" ? "tx-ok" : "tx-pending"}`} data-phase={tx.phase}>
      <div className="tx-head">
        <strong>{tx.label}</strong>
        {tx.hash && (
          <a href={`${EXPLORER_BASE}/tx/${tx.hash}`} target="_blank" rel="noreferrer">{short(tx.hash)}</a>
        )}
      </div>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i < reached || (i === reached && !failed && tx.phase === "finalized") ? "done" : i === reached ? (failed ? "fail" : "now") : ""}>
            {STEP_LABEL[s]}
          </li>
        ))}
      </ol>
      {failed && <p className="tx-msg" role="alert">{tx.message}</p>}
      {tx.phase === "finalized" && (tx.summary || tx.result?.returnValue) && <p className="tx-msg">Result: {tx.summary ?? tx.result.returnValue}</p>}
      {tx.phase !== "finalized" && !failed && tx.hash && <p className="tx-msg muted">Waiting for validators… this can take a minute, longer for a judge call.</p>}
    </li>
  );
}

export default function TxLog({ txs }) {
  if (!txs.length) return null;
  return (
    <section className="card txlog" aria-label="Transactions">
      <h3>Your transactions</h3>
      <p className="muted small">A transaction counts only once it is FINALIZED with validator agreement.</p>
      <ul>{txs.map((t) => <TxItem key={t.id} tx={t} />)}</ul>
    </section>
  );
}
