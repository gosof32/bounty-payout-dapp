import React, { useState } from "react";
import {
  CLAIM_STATUS_TEXT, CODE_TEXT, PHASE_TEXT, bountyActions, claimActions, commitUrl, criteriaWithResults, formatReward,
  parsePrRef, phaseOf, prBodySnippet, relative, repoUrl, summarizeJudgeResult, when,
} from "../lib/bounty.js";
import { EXPLORER_BASE } from "../config.js";
import { StatusBadge } from "./BountyList.jsx";
import CopyButton from "./CopyButton.jsx";
import { short } from "./TxLog.jsx";

const addrLink = (a) => (
  <a href={`${EXPLORER_BASE}/address/${a}`} target="_blank" rel="noreferrer" title={a}>{short(a)}</a>
);

export default function BountyDetail({ bounty, claims, wallet, busy, now, onAction, onConnect }) {
  const phase = phaseOf(bounty, now);
  const can = bountyActions(bounty, { wallet, claims, now });
  const winner = claims?.find((c) => c.id === bounty.winner_claim);

  return (
    <article className="detail" aria-label={`Bounty ${bounty.id}`}>
      <p><a href="#/" className="back">← All bounties</a></p>
      <section className="card">
        <header className="card-head">
          <div>
            <span className="muted">Bounty #{bounty.id}</span>
            <h2 className="detail-title">{bounty.title}</h2>
          </div>
          <StatusBadge status={bounty.status} phase={phase} />
        </header>
        <p className="phase-line">{PHASE_TEXT[phase]}</p>
        <div className="reward big">{formatReward(bounty.reward)}</div>

        <div className="links">
          <a className="gh" href={bounty.issue_url} target="_blank" rel="noreferrer">Issue {bounty.repo}#{bounty.issue} ↗</a>
          <a className="gh" href={repoUrl(bounty.repo)} target="_blank" rel="noreferrer">Repository ↗</a>
          {winner && <a className="gh" href={winner.pr_url} target="_blank" rel="noreferrer">Winning PR #{winner.pr_number} ↗</a>}
        </div>

        <dl className="facts">
          <div><dt>Sponsor</dt><dd>{addrLink(bounty.sponsor)}{wallet && bounty.sponsor?.toLowerCase() === wallet.toLowerCase() ? " (you)" : ""}</dd></div>
          <div><dt>Created</dt><dd>{when(bounty.created_at)}</dd></div>
          <div><dt>Claim &amp; merge deadline</dt><dd>{when(bounty.deadline)} <span className="muted">({relative(bounty.deadline, now)})</span></dd></div>
          <div><dt>Judging until</dt><dd>{when(bounty.judge_deadline)} <span className="muted">({relative(bounty.judge_deadline, now)})</span></dd></div>
          <div><dt>Max pending claims</dt><dd>{bounty.max_claims}</dd></div>
          <div><dt>Judgements per claim</dt><dd>{bounty.max_attempts}</dd></div>
          {bounty.closed_at && <div><dt>Closed</dt><dd>{when(bounty.closed_at)}</dd></div>}
          <div><dt>Claims</dt><dd>{bounty.claim_count}</dd></div>
        </dl>

        <h3>Acceptance criteria</h3>
        <ol className="criteria">
          {bounty.criteria.map((c, i) => <li key={i}>{c}</li>)}
        </ol>

        {bounty.status === "OPEN" && (
          <div className="actions">
            {can.cancel && (
              <button disabled={busy} onClick={() => onAction(`Cancel bounty #${bounty.id}`, "cancel_bounty", [bounty.id])}>
                Cancel bounty · return reward
              </button>
            )}
            {can.cancelBlockedByLiveClaim && (
              <span className="muted small">You can't cancel while a claim can still be judged.</span>
            )}
            {can.refund && (
              <button disabled={busy} onClick={() => onAction(`Refund bounty #${bounty.id}`, "refund", [bounty.id])}>
                Refund to sponsor
              </button>
            )}
          </div>
        )}
      </section>

      <section className="card" aria-label="Claims">
        <h3>Claims</h3>
        {claims === null && <p className="muted">Loading claims…</p>}
        {claims?.length === 0 && <p className="muted">No claims yet.</p>}
        {claims?.map((c) => (
          <ClaimCard key={c.id} bounty={bounty} claim={c} wallet={wallet} busy={busy} now={now} onAction={onAction} />
        ))}
      </section>

      {bounty.status === "OPEN" && (
        <SubmitClaim bounty={bounty} wallet={wallet} can={can} busy={busy} onAction={onAction} onConnect={onConnect} />
      )}
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
      <div className="card-head">
        <div>
          <strong>Claim #{claim.id}</strong>{" "}
          <a href={claim.pr_url} target="_blank" rel="noreferrer">PR #{claim.pr_number} ↗</a>
        </div>
        <span className={`badge b-${claim.status.toLowerCase()}`}>{claim.status}</span>
      </div>
      <p className="muted small">
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
            <li key={code}><code>{code}</code> {CODE_TEXT[code] ?? ""}</li>
          ))}
        </ul>
      )}

      {judged && (
        <table className="verdicts">
          <thead><tr><th>Criterion</th><th>Result</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  {r.text}
                  {r.reason && <div className="reason">{r.reason}</div>}
                </td>
                <td className={r.pass === true ? "pass" : r.pass === false ? "fail" : "muted"}>
                  {r.pass === true ? "✓ pass" : r.pass === false ? "✗ fail" : "not graded"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {judged && claim.criteria_results.length === 0 && claim.codes.length > 0 && (
        <p className="muted small">A hard check failed, so the criteria were not sent to the model.</p>
      )}

      <div className="actions">
        {act.judge && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => onAction(`${act.label} claim #${claim.id} (PR #${claim.pr_number})`, "judge", [claim.id], 0n, { summarize: summarizeJudgeResult })}
          >
            {act.label} with validators
          </button>
        )}
        {act.reason && <span className="muted small">{act.reason}</span>}
      </div>
    </div>
  );
}

function SubmitClaim({ bounty, wallet, can, busy, onAction, onConnect }) {
  const [pr, setPr] = useState("");
  const [err, setErr] = useState("");
  const snippet = prBodySnippet(wallet, bounty.issue);

  const submit = (e) => {
    e.preventDefault();
    setErr("");
    let n;
    try { n = parsePrRef(pr, bounty.repo); } catch (x) { return setErr(x.message); }
    onAction(`Claim bounty #${bounty.id} with PR #${n}`, "submit_claim", [bounty.id, String(n)]);
  };

  return (
    <form className="card form" onSubmit={submit} aria-label="Submit a claim">
      <h3>Claim this bounty</h3>
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
            <button type="button" onClick={onConnect}>Connect wallet to fill in your address</button>
          )}
        </div>
        <p className="muted small">
          Claim from the same wallet. You can claim while the PR is still open; judging returns NOT_READY (no attempt used) until it is merged.
        </p>
      </div>

      <label>
        Pull request (number or URL)
        <input value={pr} onChange={(e) => setPr(e.target.value)} placeholder={`42 or https://github.com/${bounty.repo}/pull/42`} aria-label="Pull request" />
      </label>
      {!can.submitClaim && can.claimBlock && <p className="muted small">{can.claimBlock}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <button className="primary" type="submit" disabled={busy || !can.submitClaim}>Submit claim</button>
    </form>
  );
}
