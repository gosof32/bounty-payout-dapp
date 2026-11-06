import React, { useState } from "react";
import { PHASE_TEXT, formatReward, phaseOf, relative, when } from "../lib/bounty.js";
import Icon from "./Icons.jsx";

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
      <span className="badge-dot" aria-hidden="true" />
      {status}
    </span>
  );
}

// Phase chip for an OPEN bounty: where it sits on its timeline.
export function PhaseChip({ phase, children }) {
  return (
    <span className={`phase-chip ph-${String(phase).toLowerCase()}`}>
      <Icon name="clock" size={14} />
      {children}
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
          <button key={k} className={`chip f-${k.toLowerCase()}${filter === k ? " on" : ""}`} onClick={() => setFilter(k)} aria-pressed={filter === k}>
            {label} <span className="chip-count">{count(k)}</span>
          </button>
        ))}
      </div>
      {bounties && shown.length === 0 && <p className="muted empty-filter">No bounties match this filter.</p>}
      <div className="bounty-grid">
        {shown.map((b, i) => {
          const phase = phaseOf(b, now);
          const open = b.status === "OPEN";
          return (
            <a
              key={b.id}
              className={`poster p-${b.status.toLowerCase()}`}
              href={`#/bounty/${b.id}`}
              aria-label={`Bounty ${b.id}: ${b.title}`}
              style={{ "--i": Math.min(i, 8) }}
            >
              <header className="poster-head">
                <span className="poster-id">Bounty #{b.id}</span>
                <StatusBadge status={b.status} phase={phase} />
              </header>
              <div className="poster-reward">
                <span className="poster-label">Reward</span>
                <div className="reward">{formatReward(b.reward)}</div>
              </div>
              <h3 className="poster-title">{b.title}</h3>
              <p className="repo-line"><Icon name="github" size={14} /><code>{b.repo}#{b.issue}</code></p>
              <div className="poster-foot">
                {open ? (
                  <PhaseChip phase={phase}>{PHASE_TEXT[phase]} · deadline {relative(b.deadline, now)}</PhaseChip>
                ) : (
                  <span className="closed-line">{PHASE_TEXT[b.status]} {b.closed_at ? `· ${when(b.closed_at)}` : ""}</span>
                )}
                <p className="poster-meta">
                  <span><Icon name="doc" size={14} />{b.criteria.length} criteri{b.criteria.length === 1 ? "on" : "a"}</span>
                  <span><Icon name="pr" size={14} />{b.claim_count} claim{b.claim_count === 1 ? "" : "s"}</span>
                  <span className="poster-go" aria-hidden="true"><Icon name="arrowRight" size={16} /></span>
                </p>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
