import React, { useState } from "react";
import {
  CLAIM_STATUS_TEXT, CODE_TEXT, PHASE_TEXT, bountyActions, claimActions, commitUrl, criteriaWithResults, formatReward,
  parsePrRef, phaseOf, prBodySnippet, relative, repoUrl, summarizeJudgeResult, when,
} from "../lib/bounty.js";
import { EXPLORER_BASE } from "../config.js";
import { PhaseChip, StatusBadge } from "./BountyList.jsx";
import CopyButton from "./CopyButton.jsx";
import Icon from "./Icons.jsx";
import { short } from "./TxLog.jsx";
import PrCheck, { PreflightResult, usePreflight } from "./PrCheck.jsx";
import EmbedBadge from "./EmbedBadge.jsx";

const addrLink = (a) => (
  <a className="mono" href={`${EXPLORER_BASE}/address/${a}`} target="_blank" rel="noreferrer" title={a}>{short(a)}</a>
);

// The bounty lifecycle as timeline steps: created → claims → judged → settled.
function lifecycle(bounty, claims, phase, now) {
  const open = bounty.status === "OPEN";
  const judged = (claims ?? []).filter((c) => c.attempts > 0).length;
  const winner = (claims ?? []).find((c) => c.id === bounty.winner_claim);
  const claimsState = !open || phase !== "OPEN" ? "done" : "now";
  const judgeState = !open || phase === "EXPIRED" ? "done" : phase === "JUDGING" || judged > 0 ? "now" : "next";
  let outcome;
  if (bounty.status === "PAID") {
    outcome = { state: "done paid", icon: "coins", title: "Paid to the hunter", text: `${winner ? `Claim #${winner.id} accepted · ` : ""}${bounty.closed_at ? when(bounty.closed_at) : ""}` };
  } else if (bounty.status === "REFUNDED") {
    outcome = { state: "done refunded", icon: "undo", title: "Refunded to the sponsor", text: bounty.closed_at ? when(bounty.closed_at) : "" };
  } else if (bounty.status === "CANCELLED") {
    outcome = { state: "done cancelled", icon: "ban", title: "Cancelled by the sponsor", text: bounty.closed_at ? when(bounty.closed_at) : "" };
  } else if (phase === "EXPIRED") {
    outcome = { state: "now", icon: "undo", title: "Refundable", text: "Judging window over. Anyone can refund the sponsor." };
  } else {
    outcome = { state: "next", icon: "coins", title: "Payout", text: "Paid in the same transaction as an accepted judgement." };
  }
  return [
    { state: "done", icon: "flag", title: "Bounty created", text: `${when(bounty.created_at)} · ${formatReward(bounty.reward)} escrowed` },
    {
      state: claimsState, icon: "pr", title: `${bounty.claim_count} claim${bounty.claim_count === 1 ? "" : "s"} submitted`,
      text: `Claim & merge deadline ${when(bounty.deadline)} (${relative(bounty.deadline, now)})`,
    },
    {
      state: judgeState, icon: "scale", title: `${judged} claim${judged === 1 ? "" : "s"} judged by validators`,
      text: `Judging until ${when(bounty.judge_deadline)} (${relative(bounty.judge_deadline, now)})`,
    },
    outcome,
  ];
}

export default function BountyDetail({ bounty, claims, wallet, busy, now, onAction, onConnect, fetchPr }) {
  const phase = phaseOf(bounty, now);
  const can = bountyActions(bounty, { wallet, claims, now });
  const winner = claims?.find((c) => c.id === bounty.winner_claim);
  const steps = lifecycle(bounty, claims, phase, now);
  const isSponsor = wallet && bounty.sponsor?.toLowerCase() === wallet.toLowerCase();

  return (
    <article className="detail" aria-label={`Bounty ${bounty.id}`}>
      <a href="#/" className="back"><Icon name="arrowLeft" size={16} />All bounties</a>

      <section className={`detail-hero p-${bounty.status.toLowerCase()}`}>
        <div className="detail-hero-main">
          <div className="detail-meta">
            <span className="poster-id">Bounty #{bounty.id}</span>
            <StatusBadge status={bounty.status} phase={phase} />
            {bounty.status === "OPEN" && <PhaseChip phase={phase}>{PHASE_TEXT[phase]}</PhaseChip>}
          </div>
          <h2 className="detail-title">{bounty.title}</h2>
          <p className="repo-line"><Icon name="github" size={15} /><code>{bounty.repo}#{bounty.issue}</code></p>
        </div>
        <div className="detail-reward">
          <span className="poster-label">Reward</span>
          <div className="reward big">{formatReward(bounty.reward)}</div>
        </div>

        <div className="links">
          <a className="btn ghost sm mono-btn" href={bounty.issue_url} target="_blank" rel="noreferrer">Issue {bounty.repo}#{bounty.issue} ↗</a>
          <a className="btn ghost sm" href={repoUrl(bounty.repo)} target="_blank" rel="noreferrer">Repository ↗</a>
          {winner && <a className="btn win sm" href={winner.pr_url} target="_blank" rel="noreferrer">Winning PR #{winner.pr_number} ↗</a>}
          <a className="btn ghost sm" href={`${EXPLORER_BASE}/address/${bounty.sponsor}`} target="_blank" rel="noreferrer">Sponsor on explorer ↗</a>
        </div>

        {bounty.status === "OPEN" && (can.cancel || can.cancelBlockedByLiveClaim || can.refund) && (
          <div className="actions">
            {can.cancel && (
              <button className="btn danger" disabled={busy} onClick={() => onAction(`Cancel bounty #${bounty.id}`, "cancel_bounty", [bounty.id])}>
                <Icon name="ban" size={16} />Cancel bounty · return reward
              </button>
            )}
            {can.cancelBlockedByLiveClaim && (
              <span className="muted small">You can't cancel while a claim can still be judged.</span>
            )}
            {can.refund && (
              <button className="btn ghost" disabled={busy} onClick={() => onAction(`Refund bounty #${bounty.id}`, "refund", [bounty.id])}>
                <Icon name="undo" size={16} />Refund to sponsor
              </button>
            )}
          </div>
        )}
      </section>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel">
            <h3><Icon name="doc" size={18} />Acceptance criteria</h3>
            <ol className="criteria">
              {bounty.criteria.map((c, i) => <li key={i}><span className="crit-num">{i + 1}</span><span>{c}</span></li>)}
            </ol>
          </section>

          <section className="panel" aria-label="Claims">
            <h3><Icon name="pr" size={18} />Claims <span className="count-pill">{claims?.length ?? "…"}</span></h3>
            {claims === null && <p className="muted">Loading claims…</p>}
            {claims?.length === 0 && <p className="muted empty-claims">No claims yet. Be the first hunter.</p>}
            <div className="claims">
              {claims?.map((c) => (
                <ClaimCard key={c.id} bounty={bounty} claim={c} wallet={wallet} busy={busy} now={now} onAction={onAction} />
              ))}
            </div>
          </section>

          {bounty.status === "OPEN" && (
            <SubmitClaim bounty={bounty} wallet={wallet} can={can} busy={busy} onAction={onAction} onConnect={onConnect} fetchPr={fetchPr} />
          )}

          <PrCheck bounty={bounty} claims={claims} wallet={wallet} fetchPr={fetchPr} />
        </div>

        <aside className="detail-side">
          <section className="panel" aria-label="Lifecycle">
            <h3><Icon name="clock" size={18} />Lifecycle</h3>
            <ol className="timeline">
              {steps.map((s, i) => (
                <li key={i} className={`tl ${s.state}`}>
                  <span className="tl-dot"><Icon name={s.state.startsWith("done") ? "check" : s.icon} size={14} strokeWidth={2.4} /></span>
                  <div>
                    <p className="tl-title">{s.title}</p>
                    {s.text && <p className="tl-text">{s.text}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel">
            <h3><Icon name="hash" size={18} />Details</h3>
            <dl className="facts">
              <div><dt>Sponsor</dt><dd>{addrLink(bounty.sponsor)}{isSponsor ? " (you)" : ""}</dd></div>
              <div><dt>Created</dt><dd>{when(bounty.created_at)}</dd></div>
              <div><dt>Claim &amp; merge deadline</dt><dd>{when(bounty.deadline)} <span className="muted">({relative(bounty.deadline, now)})</span></dd></div>
              <div><dt>Judging until</dt><dd>{when(bounty.judge_deadline)} <span className="muted">({relative(bounty.judge_deadline, now)})</span></dd></div>
              <div><dt>Max pending claims</dt><dd>{bounty.max_claims}</dd></div>
              <div><dt>Judgements per claim</dt><dd>{bounty.max_attempts}</dd></div>
              {bounty.closed_at && <div><dt>Closed</dt><dd>{when(bounty.closed_at)}</dd></div>}
              <div><dt>Claims</dt><dd>{bounty.claim_count}</dd></div>
            </dl>
          </section>

          <EmbedBadge bounty={bounty} />
        </aside>
      </div>
    </article>
  );
}

function ClaimCard({ bounty, claim, wallet, busy, now, onAction }) {
  const act = claimActions(bounty, claim, { wallet, now });
  const rows = criteriaWithResults(bounty.criteria, claim.criteria_results);
  const judged = claim.attempts > 0;
  const mine = wallet && claim.hunter?.toLowerCase() === wallet.toLowerCase();

  return (
    <div className={`claim c-${claim.status.toLowerCase()}`} aria-label={`Claim ${claim.id}`}>
      <div className="claim-head">
        <div className="claim-title">
          <strong>Claim #{claim.id}</strong>
          <span className={`badge b-${claim.status.toLowerCase()}`}><span className="badge-dot" aria-hidden="true" />{claim.status}</span>
        </div>
        <a className="btn ghost xs" href={claim.pr_url} target="_blank" rel="noreferrer">PR #{claim.pr_number} ↗</a>
      </div>
      <p className="claim-meta">
        {CLAIM_STATUS_TEXT[claim.status]} · hunter {addrLink(claim.hunter)}{mine ? " (you)" : ""} · submitted {when(claim.submitted_at)}
      </p>

      {judged && (
        <dl className="facts small-facts">
          <div><dt>Judged</dt><dd>{when(claim.judged_at)} · {claim.attempts} attempt{claim.attempts === 1 ? "" : "s"}, {claim.attempts_left} left</dd></div>
          {claim.pr_author && <div><dt>PR author</dt><dd><a href={`https://github.com/${claim.pr_author}`} target="_blank" rel="noreferrer">@{claim.pr_author}</a></dd></div>}
          {claim.merged_at && <div><dt>Merged</dt><dd>{when(claim.merged_at)}</dd></div>}
          {claim.merge_sha && <div><dt>Merge commit</dt><dd><a href={commitUrl(bounty.repo, claim.merge_sha)} target="_blank" rel="noreferrer"><code>{claim.merge_sha.slice(0, 10)}</code></a></dd></div>}
          {claim.paid > 0n && <div><dt>Paid</dt><dd>{formatReward(claim.paid)}</dd></div>}
          {claim.evidence_hash && <div><dt>Evidence hash</dt><dd><code title={claim.evidence_hash}>{claim.evidence_hash.slice(0, 16)}…</code></dd></div>}
        </dl>
      )}

      {claim.codes.length > 0 && (
        <ul className="codes" aria-label="Rejection reasons">
          {claim.codes.map((code) => (
            <li key={code}><Icon name="x" size={15} strokeWidth={2.4} /><div><code>{code}</code> {CODE_TEXT[code] ?? ""}</div></li>
          ))}
        </ul>
      )}

      {judged && (
        <ul className="verdicts" aria-label="Criteria verdicts">
          {rows.map((r, i) => {
            const kind = r.pass === true ? "pass" : r.pass === false ? "fail" : "none";
            return (
              <li key={i} className={`verdict v-${kind}`}>
                <span className="v-icon"><Icon name={kind === "pass" ? "check" : kind === "fail" ? "x" : "clock"} size={14} strokeWidth={2.6} /></span>
                <div className="v-body">
                  <p className="v-text">{r.text}</p>
                  {r.reason && <div className="reason">{r.reason}</div>}
                </div>
                <span className={`v-tag ${r.pass === true ? "pass" : r.pass === false ? "fail" : "muted"}`}>
                  {r.pass === true ? "✓ pass" : r.pass === false ? "✗ fail" : "not graded"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {judged && claim.criteria_results.length === 0 && claim.codes.length > 0 && (
        <p className="muted small">A hard check failed, so the criteria were not sent to the model.</p>
      )}

      {(act.judge || act.reason) && (
        <div className="actions">
          {act.judge && (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => onAction(`${act.label} claim #${claim.id} (PR #${claim.pr_number})`, "judge", [claim.id], 0n, { summarize: summarizeJudgeResult })}
            >
              <Icon name="scale" size={16} />{act.label} with validators
            </button>
          )}
          {act.reason && <span className="muted small">{act.reason}</span>}
        </div>
      )}
    </div>
  );
}

function SubmitClaim({ bounty, wallet, can, busy, onAction, onConnect, fetchPr }) {
  const [pr, setPr] = useState("");
  const [err, setErr] = useState("");
  const snippet = prBodySnippet(wallet, bounty.issue);
  // Preflight: the contract's hard checks, run on the live PR before anything is signed.
  const check = usePreflight({ bounty, prRef: pr, hunter: wallet ?? "", fetchPr });
  const failing = check.result && check.result.kind === "JUDGED" && check.result.codes.filter((c) => wallet || c !== "MISSING_AUTHORSHIP").length > 0;

  const submit = (e) => {
    e.preventDefault();
    setErr("");
    let n;
    try { n = parsePrRef(pr, bounty.repo); } catch (x) { return setErr(x.message); }
    onAction(`Claim bounty #${bounty.id} with PR #${n}`, "submit_claim", [bounty.id, String(n)]);
  };

  return (
    <form className="panel form claim-form" onSubmit={submit} aria-label="Submit a claim">
      <h3><Icon name="flag" size={18} />Claim this bounty</h3>
      <div className="helper">
        <p>
          <b>Before you claim:</b> your pull request must be merged into <code>{bounty.repo}</code> by the deadline, reference
          the issue, and <b>contain your wallet address in the PR body</b>. That address is your proof of authorship: the
          reward can only go to the address written in the PR. Add these lines to the PR description:
        </p>
        <pre className="snippet" aria-label="PR body snippet">{snippet}</pre>
        <div className="row">
          {wallet ? (
            <>
              <CopyButton text={snippet} label="Copy PR body lines" />
              <CopyButton text={wallet} label="Copy my address" />
            </>
          ) : (
            <button type="button" className="btn ghost sm" onClick={onConnect}><Icon name="wallet" size={15} />Connect wallet to fill in your address</button>
          )}
        </div>
        <p className="muted small">
          Claim from the same wallet. You can claim while the PR is still open; judging returns NOT_READY (no attempt used) until it is merged.
        </p>
      </div>

      <div className="field">
        <label htmlFor="claim-pr">Pull request</label>
        <input id="claim-pr" value={pr} onChange={(e) => setPr(e.target.value)} placeholder={`42 or https://github.com/${bounty.repo}/pull/42`} aria-label="Pull request" />
        <span className="hint">The PR number or its full URL. We check it against the contract's rules before you sign.</span>
      </div>
      <PreflightResult bounty={bounty} check={check} hunter={wallet ?? ""} showRefError={false} />
      {!can.submitClaim && can.claimBlock && <p className="muted small">{can.claimBlock}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="form-actions">
        {failing ? (
          <button className="btn danger" type="submit" disabled={busy || !can.submitClaim}>Submit anyway (would be rejected)</button>
        ) : (
          <button className="btn primary" type="submit" disabled={busy || !can.submitClaim}>Submit claim</button>
        )}
      </div>
    </form>
  );
}
