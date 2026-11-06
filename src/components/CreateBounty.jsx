import React, { useState } from "react";
import { LIMITS, buildCreateBounty, parseCriteria, parseRepoInput } from "../lib/bounty.js";
import Icon from "./Icons.jsx";
import { short } from "./TxLog.jsx";

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
const localInput = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function Field({ id, label, hint, className = "", extra, children }) {
  return (
    <div className={`field ${className}`}>
      <div className="field-label">
        <label htmlFor={id}>{label}</label>
        {extra}
      </div>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export default function CreateBounty({ wallet, busy, onCreate, onConnect }) {
  const [repo, setRepo] = useState("");
  const [issue, setIssue] = useState("");
  const [title, setTitle] = useState("");
  const [criteria, setCriteria] = useState("");
  const [reward, setReward] = useState("1");
  const [deadline, setDeadline] = useState(localInput(Date.now() + 7 * 86400000));
  const [graceHours, setGraceHours] = useState("72");
  const [maxClaims, setMaxClaims] = useState("3");
  const [maxAttempts, setMaxAttempts] = useState("2");
  const [err, setErr] = useState("");

  const onRepo = (v) => {
    const parsed = parseRepoInput(v);
    if (parsed.issue) {
      setRepo(parsed.repo);
      setIssue(String(parsed.issue));
    } else setRepo(v);
  };

  const submit = (e) => {
    e.preventDefault();
    setErr("");
    try {
      const { args, value } = buildCreateBounty({
        repo: parseRepoInput(repo).repo, issue, title, criteria, reward,
        deadline: new Date(deadline), graceHours, maxClaims, maxAttempts,
      });
      onCreate(args, value);
    } catch (x) {
      setErr(x.message);
    }
  };

  const n = parseCriteria(criteria).length;

  return (
    <form className="panel form create-form" onSubmit={submit} aria-label="Create a bounty">
      <div className="form-head">
        <p className="eyebrow">New bounty</p>
        <h2 className="section-title">Post a bounty</h2>
        <p className="muted">
          The reward is escrowed in the contract when you create the bounty. It goes to the first hunter whose merged PR passes every
          check, or back to you on cancel/refund. {wallet ? <>Sponsor: <b className="mono">{short(wallet)}</b> (your connected wallet).</> : "Connect a wallet to sponsor a bounty."}
        </p>
      </div>

      <fieldset className="form-section">
        <legend><span className="legend-num">1</span>The issue</legend>
        <div className="grid">
          <Field id="f-repo" label="Repository" className="span2" hint="owner/repo, or paste the full issue URL to fill both fields.">
            <input id="f-repo" value={repo} onChange={(e) => onRepo(e.target.value)} placeholder="acme/widgets" aria-label="Repository" autoComplete="off" spellCheck={false} />
          </Field>
          <Field id="f-issue" label="Issue #" hint="Public repos only.">
            <input id="f-issue" value={issue} onChange={(e) => setIssue(e.target.value)} inputMode="numeric" placeholder="7" aria-label="Issue number" />
          </Field>
          <Field id="f-title" label="Title" className="span3" extra={<span className="counter">{title.length}/{LIMITS.titleMax}</span>}>
            <input id="f-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.titleMax} placeholder="Add a --dry-run flag to the CLI" aria-label="Title" />
          </Field>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend><span className="legend-num">2</span>Acceptance criteria</legend>
        <Field
          id="f-criteria"
          label="One per line"
          extra={<span className={`counter ${n > LIMITS.maxCriteria ? "over" : ""}`}>{n}/{LIMITS.maxCriteria}</span>}
          hint="Write criteria a reviewer can check from the PR's files and description, not matters of taste."
        >
          <textarea
            id="f-criteria"
            rows={5}
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            placeholder={"Adds a --dry-run flag to the CLI\nIncludes a unit test for the new flag\nDocuments the flag in README.md"}
            aria-label="Acceptance criteria"
          />
        </Field>
      </fieldset>

      <fieldset className="form-section">
        <legend><span className="legend-num">3</span>Reward &amp; timing</legend>
        <div className="grid">
          <Field id="f-reward" label="Reward (GEN)" hint="Sent with the transaction and held in escrow.">
            <div className="input-unit">
              <input id="f-reward" value={reward} onChange={(e) => setReward(e.target.value)} inputMode="decimal" aria-label="Reward" />
              <span aria-hidden="true">GEN</span>
            </div>
          </Field>
          <Field id="f-deadline" label="Deadline (your time)" hint="Claims and the merge must land before this.">
            <input id="f-deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-label="Deadline" />
          </Field>
          <Field id="f-grace" label="Judging grace (hours)" hint="Extra time after the deadline to judge.">
            <input id="f-grace" value={graceHours} onChange={(e) => setGraceHours(e.target.value)} inputMode="numeric" aria-label="Judging grace" />
          </Field>
          <Field id="f-claims" label="Max pending claims" hint={`Up to ${LIMITS.maxClaims}.`}>
            <input id="f-claims" value={maxClaims} onChange={(e) => setMaxClaims(e.target.value)} inputMode="numeric" aria-label="Max pending claims" />
          </Field>
          <Field id="f-attempts" label="Judgements per claim" hint={`Up to ${LIMITS.maxAttempts}.`}>
            <input id="f-attempts" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} inputMode="numeric" aria-label="Judgements per claim" />
          </Field>
        </div>
      </fieldset>

      <p className="note small">
        <Icon name="shield" size={16} />
        <span>Public repositories only: validators read the GitHub API without a token. PRs must be merged after the bounty is created and before the deadline.</span>
      </p>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="form-actions">
        {wallet ? (
          <button className="btn primary lg" type="submit" disabled={busy}><Icon name="coins" size={18} />Create bounty · escrow {reward || "0"} GEN</button>
        ) : (
          <button className="btn primary lg" type="button" onClick={onConnect}><Icon name="wallet" size={18} />Connect wallet to post</button>
        )}
      </div>
    </form>
  );
}
