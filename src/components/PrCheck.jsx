import React, { useEffect, useRef, useState } from "react";
import { CODE_TEXT, prUrl, when } from "../lib/bounty.js";
import {
  ADDRESS_RE, RateLimitError, checklist, evaluate, fetchPullRequest as defaultFetchPr, findAddresses,
  parsePrRefContract, verdict,
} from "../lib/preflight.js";
import Icon from "./Icons.jsx";
import { short } from "./TxLog.jsx";

// Runs the contract's hard-fact checks (ported in src/lib/preflight.js) against the live
// GitHub API for one PR and one hunter address. Read-only: no wallet, no chain writes.
export function usePreflight({ bounty, prRef, hunter, fetchPr = defaultFetchPr, debounceMs = 500 }) {
  const [state, setState] = useState({ status: "idle" });
  const seq = useRef(0);
  const [nonce, setNonce] = useState(0);

  let number = null;
  let refError = null;
  if (String(prRef ?? "").trim()) {
    try { number = parsePrRefContract(prRef, bounty.repo); } catch (e) { refError = e.message; }
  }
  const hunterOk = !hunter || ADDRESS_RE.test(hunter);

  useEffect(() => {
    if (number === null) { setState({ status: "idle" }); return undefined; }
    const my = ++seq.current;
    setState((s) => ({ ...s, status: "loading", number }));
    const t = setTimeout(async () => {
      try {
        const gh = await fetchPr(bounty.repo, number, { useCache: nonce === 0 });
        if (my !== seq.current) return;
        setState({ status: "done", number, gh });
      } catch (e) {
        if (my !== seq.current) return;
        if (e instanceof RateLimitError) setState({ status: "ratelimit", number, resetAt: e.resetAt });
        else setState({ status: "error", number, message: e?.message ?? String(e) });
      }
    }, debounceMs);
    return () => clearTimeout(t);
  }, [bounty.repo, number, nonce, fetchPr, debounceMs]);

  let result = null;
  if (state.status === "done" && state.number === number) {
    result = evaluate({
      pr: state.gh.pr, files: state.gh.files, repo: bounty.repo, issue: bounty.issue,
      hunter: hunter && hunterOk ? hunter : "", createdAt: bounty.created_at, deadline: bounty.deadline,
    });
  }
  return { ...state, number, refError, result, hunterOk, recheck: () => setNonce((n) => n + 1) };
}

export function PreflightResult({ bounty, check, hunter, showRefError = true }) {
  const { status, number, result, refError } = check;
  if (refError && !showRefError) return null;
  if (refError) return <p className="error small" role="alert">The contract would refuse this claim: <code>{refError}</code></p>;
  if (status === "idle" || number === null) return null;
  if (status === "loading" || (status === "done" && !result)) {
    return <p className="muted small preflight-loading" aria-live="polite"><span className="spinner" aria-hidden="true" />Reading PR #{number} from the GitHub API…</p>;
  }
  if (status === "ratelimit") {
    return (
      <div className="preflight p-warn" role="status">
        <p className="pf-verdict"><Icon name="clock" size={16} />Couldn't run the preflight: GitHub's public API rate limit (60 unauthenticated requests/hour per IP) is used up
          {check.resetAt ? `; it resets at ${check.resetAt.toLocaleTimeString(undefined, { timeStyle: "short" })}` : ""}.</p>
        <p className="muted small">This is only the in-browser check. You can still sign; validators read GitHub themselves when judging.</p>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="preflight p-warn" role="status">
        <p className="pf-verdict"><Icon name="x" size={16} />Couldn't reach GitHub: {check.message}</p>
        <button type="button" className="btn ghost xs" onClick={check.recheck}><Icon name="refresh" size={14} />Retry</button>
      </div>
    );
  }

  const v = verdict(result, { hunter: hunter && check.hunterOk ? hunter : "" });
  const rows = checklist(result, {
    repo: bounty.repo, issue: bounty.issue, hunter: hunter && check.hunterOk ? hunter : "",
    createdAt: bounty.created_at, deadline: bounty.deadline, fmt: when,
  });
  const notFound = result.kind === "INCONCLUSIVE" && check.gh?.prStatus === 404;
  const body = check.gh?.pr?.body ?? "";
  const found = findAddresses(body);

  return (
    <div className={`preflight p-${v.tone}`} aria-label="Preflight checklist">
      <div className="pf-head">
        <p className="pf-verdict" role="status">
          <Icon name={v.tone === "pass" ? "check" : v.tone === "fail" ? "x" : "clock"} size={16} strokeWidth={2.4} />
          <span>{notFound ? `GitHub has no pull request #${number} in ${bounty.repo}. ` : ""}{v.text}</span>
        </p>
        <a className="btn ghost xs" href={prUrl(bounty.repo, number)} target="_blank" rel="noreferrer">PR #{number} ↗</a>
      </div>
      {rows.length > 0 && (
        <ul className="pf-list">
          {rows.map((r) => {
            const kind = r.pass === true ? "pass" : r.pass === false ? "fail" : "none";
            return (
              <li key={r.key} className={`pf-row v-${kind}`}>
                <span className="v-icon"><Icon name={kind === "pass" ? "check" : kind === "fail" ? "x" : "clock"} size={13} strokeWidth={2.6} /></span>
                <div className="pf-body">
                  <p className="pf-label">{r.label}</p>
                  <p className="pf-detail">{r.detail}</p>
                </div>
                <code className={`pf-code ${kind}`}>{kind === "pass" ? "ok" : kind === "fail" ? r.code.split("/").find((c) => result.codes.includes(c)) ?? r.code : "n/a"}</code>
              </li>
            );
          })}
        </ul>
      )}
      {v.codes?.length > 0 && (
        <ul className="codes" aria-label="Would be rejected with">
          {v.codes.map((c) => <li key={c}><Icon name="x" size={15} strokeWidth={2.4} /><div><code>{c}</code> {CODE_TEXT[c]}</div></li>)}
        </ul>
      )}
      {found.length > 0 && result.facts && !result.facts.has_address && (
        <p className="muted small pf-found">Addresses in this PR body: {found.map((a) => <code key={a} title={a}>{short(a)}</code>)}</p>
      )}
      <p className="muted small pf-foot">
        Same rules as the contract's <code>_hard_facts</code>/<code>_hard_codes</code>, run on the public GitHub API right now
        {result.facts ? ` (${result.facts.files} changed file${result.facts.files === 1 ? "" : "s"})` : ""}. Validators re-read GitHub when judging; the acceptance criteria are graded by their LLM and are not simulated here.
      </p>
    </div>
  );
}

// "Check a PR": the read-only preflight tool on the bounty page (no wallet needed).
export default function PrCheck({ bounty, claims, wallet, fetchPr }) {
  const [pr, setPr] = useState("");
  const [hunter, setHunter] = useState(wallet ?? "");
  const check = usePreflight({ bounty, prRef: pr, hunter: hunter.trim(), fetchPr });
  const claimants = (claims ?? []).map((c) => ({ id: c.id, hunter: c.hunter }));
  const pick = [];
  if (wallet) pick.push({ key: "me", label: `My wallet ${short(wallet)}`, value: wallet });
  for (const c of claimants) {
    if (!pick.some((p) => p.value.toLowerCase() === c.hunter.toLowerCase())) pick.push({ key: `c${c.id}`, label: `Claim #${c.id} hunter ${short(c.hunter)}`, value: c.hunter });
  }

  return (
    <section className="panel pr-check" aria-label="Check a PR">
      <h3><Icon name="shield" size={18} />Check a PR</h3>
      <p className="muted small pc-intro">
        Would this PR pass the contract's hard checks for this bounty? Runs the same rules in your browser against the public
        GitHub API. Read-only, no wallet needed.
      </p>
      <div className="pc-fields">
        <div className="field">
          <label htmlFor="pc-pr">PR to check</label>
          <input id="pc-pr" value={pr} onChange={(e) => setPr(e.target.value)} placeholder={`2 or https://github.com/${bounty.repo}/pull/2`} />
        </div>
        <div className="field">
          <label htmlFor="pc-hunter">Hunter address</label>
          <input id="pc-hunter" className="mono" value={hunter} onChange={(e) => setHunter(e.target.value)} placeholder="0x… (the wallet that claims)" spellCheck="false" />
          {!check.hunterOk && <span className="error small">Enter a 0x address with 40 hex characters.</span>}
        </div>
      </div>
      {pick.length > 0 && (
        <div className="row pc-picks" aria-label="Use an address">
          {pick.map((p) => (
            <button type="button" key={p.key} className={`chip pick${hunter.toLowerCase() === p.value.toLowerCase() ? " on" : ""}`} onClick={() => setHunter(p.value)}>{p.label}</button>
          ))}
        </div>
      )}
      <PreflightResult bounty={bounty} check={check} hunter={hunter.trim()} />
    </section>
  );
}
