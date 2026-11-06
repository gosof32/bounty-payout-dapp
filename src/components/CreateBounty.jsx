import React, { useState } from "react";
import { LIMITS, buildCreateBounty, parseCriteria, parseRepoInput } from "../lib/bounty.js";
import { short } from "./TxLog.jsx";

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
const localInput = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

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
    <form className="card form" onSubmit={submit} aria-label="Create a bounty">
      <h3>Post a bounty</h3>
      <p className="muted small">
        The reward is escrowed in the contract when you create the bounty. It goes to the first hunter whose merged PR passes every
        check, or back to you on cancel/refund. {wallet ? <>Sponsor: <b>{short(wallet)}</b> (your connected wallet).</> : "Connect a wallet to sponsor a bounty."}
      </p>
      <div className="grid">
        <label className="span2">Repository (owner/repo or paste the issue URL)
          <input value={repo} onChange={(e) => onRepo(e.target.value)} placeholder="acme/widgets" aria-label="Repository" />
        </label>
        <label>Issue #
          <input value={issue} onChange={(e) => setIssue(e.target.value)} inputMode="numeric" placeholder="7" aria-label="Issue number" />
        </label>
        <label className="span3">Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.titleMax} placeholder="Add a --dry-run flag to the CLI" aria-label="Title" />
        </label>
        <label className="span3">Acceptance criteria, one per line ({n}/{LIMITS.maxCriteria})
          <textarea
            rows={4}
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            placeholder={"Adds a --dry-run flag to the CLI\nIncludes a unit test for the new flag\nDocuments the flag in README.md"}
            aria-label="Acceptance criteria"
          />
          <span className="hint">Write criteria a reviewer can check from the PR's files and description, not matters of taste.</span>
        </label>
        <label>Reward (GEN)
          <input value={reward} onChange={(e) => setReward(e.target.value)} inputMode="decimal" aria-label="Reward" />
        </label>
        <label>Deadline (your time)
          <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-label="Deadline" />
        </label>
        <label>Judging grace (hours)
          <input value={graceHours} onChange={(e) => setGraceHours(e.target.value)} inputMode="numeric" aria-label="Judging grace" />
        </label>
        <label>Max pending claims
          <input value={maxClaims} onChange={(e) => setMaxClaims(e.target.value)} inputMode="numeric" aria-label="Max pending claims" />
        </label>
        <label>Judgements per claim
          <input value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} inputMode="numeric" aria-label="Judgements per claim" />
        </label>
      </div>
      <p className="muted small">
        Public repositories only: validators read the GitHub API without a token. PRs must be merged after the bounty is created and before the deadline.
      </p>
      {err && <p className="error" role="alert">{err}</p>}
      {wallet ? (
        <button className="primary" type="submit" disabled={busy}>Create bounty · escrow {reward || "0"} GEN</button>
      ) : (
        <button className="primary" type="button" onClick={onConnect}>Connect wallet to post</button>
      )}
    </form>
  );
}
