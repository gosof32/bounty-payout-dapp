import React, { useState } from "react";
import { PHASE_TEXT, formatReward, phaseOf, relative, when } from "../lib/bounty.js";

const FILTERS = [
  ["all", "All"],
  ["OPEN", "Open"],
  ["PAID", "Paid"],
  ["CANCELLED", "Cancelled"],
  ["REFUNDED", "Refunded"],
];

export function StatusBadge({ status, phase }) {
  const p = phase ?? status;
  return (
    <span className={`badge b-${String(status).toLowerCase()}`} title={PHASE_TEXT[p] ?? status}>
      {status}
    </span>
  );
}

export default function BountyList({ bounties, now }) {
  const [filter, setFilter] = useState("all");
  const shown = (bounties ?? []).filter((b) => filter === "all" || b.status === filter);
  const count = (s) => (bounties ?? []).filter((b) => s === "all" || b.status === s).length;

  return (
    <section aria-label="Bounties">
      <div className="filters" role="group" aria-label="Filter by status">
        {FILTERS.map(([k, label]) => (
          <button key={k} className={filter === k ? "chip on" : "chip"} onClick={() => setFilter(k)} aria-pressed={filter === k}>
            {label} <span className="muted">{count(k)}</span>
          </button>
        ))}
      </div>
      {bounties && shown.length === 0 && <p className="muted">No bounties match this filter.</p>}
      <div className="bounty-grid">
        {shown.map((b) => {
          const phase = phaseOf(b, now);
          return (
            <a key={b.id} className="card bounty-card" href={`#/bounty/${b.id}`} aria-label={`Bounty ${b.id}: ${b.title}`}>
              <header className="card-head">
                <span className="muted">#{b.id}</span>
                <StatusBadge status={b.status} phase={phase} />
              </header>
              <h3>{b.title}</h3>
              <p className="repo-line"><code>{b.repo}#{b.issue}</code></p>
              <div className="reward">{formatReward(b.reward)}</div>
              <p className="muted small">
                {b.status === "OPEN"
                  ? <>{PHASE_TEXT[phase]} · deadline {relative(b.deadline, now)}</>
                  : <>{PHASE_TEXT[b.status]} {b.closed_at ? `· ${when(b.closed_at)}` : ""}</>}
              </p>
              <p className="muted small">
                {b.criteria.length} criteri{b.criteria.length === 1 ? "on" : "a"} · {b.claim_count} claim{b.claim_count === 1 ? "" : "s"}
              </p>
            </a>
          );
        })}
      </div>
    </section>
  );
}
