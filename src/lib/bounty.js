// Reads, units, form validation and the bounty/claim state machine, mirrored from
// contracts/bounty_payout.py so the UI only offers actions the contract will accept.
// Everything here is pure (no network except the read* helpers), so it is unit-tested.

// ---------- contract constants (keep in sync with contracts/bounty_payout.py)

export const LIMITS = {
  maxCriteria: 8,
  maxClaims: 20,
  maxAttempts: 5,
  maxGraceHours: 14 * 24,
  criterionMin: 3,
  criterionMax: 200,
  titleMin: 3,
  titleMax: 120,
};

export const BOUNTY_STATUSES = ["OPEN", "PAID", "CANCELLED", "REFUNDED"];
export const CLAIM_STATUSES = ["PENDING", "ACCEPTED", "REJECTED", "SUPERSEDED", "CLOSED"];

export const CODE_TEXT = {
  NOT_MERGED: "The pull request was closed without being merged.",
  WRONG_REPO: "The pull request was merged into a different repository.",
  MERGED_BEFORE_BOUNTY: "The pull request was merged before the bounty was created.",
  MERGED_AFTER_DEADLINE: "The pull request was merged after the bounty deadline.",
  ISSUE_NOT_LINKED: "The PR title/body does not reference the issue (e.g. \"Closes #7\").",
  MISSING_AUTHORSHIP: "The PR body does not contain the hunter's wallet address.",
  CRITERIA_NOT_MET: "At least one acceptance criterion was graded as not met.",
};

export const CLAIM_STATUS_TEXT = {
  PENDING: "Waiting to be judged",
  ACCEPTED: "Accepted and paid",
  REJECTED: "Rejected",
  SUPERSEDED: "Another claim won",
  CLOSED: "Bounty closed",
};

// ---------- units (GEN has 18 decimals; contract amounts are wei integers)

const WEI = 10n ** 18n;

export function parseGen(text) {
  const s = String(text ?? "").trim();
  if (!/^\d+(\.\d{1,18})?$/.test(s)) throw new Error("Enter an amount like 10 or 2.5");
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * WEI + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

export function formatGen(wei, digits = 4) {
  const v = BigInt(wei ?? 0);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / WEI;
  const frac = (abs % WEI).toString().padStart(18, "0").slice(0, digits).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}

// Rewards on the demo bounties are tiny (100,000,000 wei), which would print as "0 GEN".
// Below 0.0001 GEN show the exact wei amount instead.
export function formatReward(wei) {
  const v = BigInt(wei ?? 0);
  if (v > 0n && v < 10n ** 14n) return `${v.toLocaleString("en-US")} wei`;
  return `${formatGen(v)} GEN`;
}

// ---------- calldata normalization (genlayer-js may return Maps and BigInts)

export function plain(v) {
  if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [k, plain(x)]));
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "bigint") return v;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

const toBig = (x) => (typeof x === "bigint" ? x : BigInt(x ?? 0));
const toNum = (x) => Number(x ?? 0);
const toList = (x) => {
  if (Array.isArray(x)) return x;
  if (typeof x === "string" && x.trim().startsWith("[")) {
    try { return JSON.parse(x); } catch { return []; }
  }
  return [];
};

export function normalizeBounty(raw) {
  const b = plain(raw) ?? {};
  return {
    ...b,
    id: toNum(b.id),
    issue: toNum(b.issue),
    reward: toBig(b.reward),
    criteria: toList(b.criteria).map(String),
    max_claims: toNum(b.max_claims),
    max_attempts: toNum(b.max_attempts),
    winner_claim: toNum(b.winner_claim),
    claim_count: toNum(b.claim_count),
    has_live_claim: !!b.has_live_claim,
    status: String(b.status ?? ""),
    closed_at: b.closed_at ?? "",
    issue_url: b.issue_url || (b.repo ? `https://github.com/${b.repo}/issues/${toNum(b.issue)}` : ""),
  };
}

export function normalizeClaim(raw) {
  const c = plain(raw) ?? {};
  return {
    ...c,
    id: toNum(c.id),
    bounty_id: toNum(c.bounty_id),
    pr_number: toNum(c.pr_number),
    attempts: toNum(c.attempts),
    attempts_left: toNum(c.attempts_left),
    paid: toBig(c.paid),
    status: String(c.status ?? ""),
    codes: toList(c.codes).map(String),
    criteria_results: toList(c.criteria_results).map((r) => ({ pass: r?.pass === true, reason: String(r?.reason ?? "") })),
  };
}

// ---------- reads

const PAGE = 50; // list_bounties caps limit at 50

export async function readStats(readClient, address) {
  const s = plain(await readClient.readContract({ address, functionName: "get_stats", args: [] })) ?? {};
  return { bounties: toNum(s.bounties), claims: toNum(s.claims) };
}

export async function readBounties(readClient, address) {
  const { bounties: total } = await readStats(readClient, address);
  const out = [];
  for (let offset = 0; offset < total; offset += PAGE) {
    const raw = await readClient.readContract({ address, functionName: "list_bounties", args: [offset, PAGE] });
    out.push(...(plain(raw) ?? []).map(normalizeBounty));
  }
  return out.sort((a, b) => b.id - a.id);
}

export async function readBounty(readClient, address, bountyId) {
  return normalizeBounty(await readClient.readContract({ address, functionName: "get_bounty", args: [bountyId] }));
}

export async function readClaims(readClient, address, bountyId) {
  const raw = await readClient.readContract({ address, functionName: "get_claims", args: [bountyId] });
  return (plain(raw) ?? []).map(normalizeClaim).sort((a, b) => a.id - b.id);
}

// ---------- state machine

const ts = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

// Where an OPEN bounty sits on its timeline. Closed bounties return their status.
export function phaseOf(bounty, now = Date.now()) {
  if (bounty.status !== "OPEN") return bounty.status;
  const deadline = ts(bounty.deadline);
  const judgeDeadline = ts(bounty.judge_deadline);
  if (deadline === null || now <= deadline) return "OPEN";
  if (judgeDeadline !== null && now <= judgeDeadline) return "JUDGING";
  return "EXPIRED";
}

export const PHASE_TEXT = {
  OPEN: "Open for claims",
  JUDGING: "Claims closed · judging window",
  EXPIRED: "Expired · refundable",
  PAID: "Paid",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

// A claim that could still be judged to ACCEPTED (contract: _is_live).
export function isLiveClaim(bounty, claim) {
  if (claim.status === "PENDING") return true;
  return claim.status === "REJECTED" && claim.attempts < bounty.max_attempts;
}

export function hasLiveClaim(bounty, claims) {
  if (bounty.status !== "OPEN") return false;
  if (claims) return claims.some((c) => isLiveClaim(bounty, c));
  return !!bounty.has_live_claim;
}

// What the given wallet can do with a bounty right now. Mirrors the contract's guards.
export function bountyActions(bounty, { wallet, claims, now = Date.now() } = {}) {
  const open = bounty.status === "OPEN";
  const deadline = ts(bounty.deadline);
  const judgeDeadline = ts(bounty.judge_deadline);
  const live = hasLiveClaim(bounty, claims);
  const beforeDeadline = deadline === null || now <= deadline;
  const pending = (claims ?? []).filter((c) => c.status === "PENDING").length;
  const mine = wallet && claims ? claims.find((c) => same(c.hunter, wallet)) : null;

  let claimBlock = null;
  if (!open) claimBlock = `Bounty is ${bounty.status}`;
  else if (!beforeDeadline) claimBlock = "Claims closed at the deadline";
  else if (mine) claimBlock = `You already claimed this bounty (claim #${mine.id})`;
  else if (claims && pending >= bounty.max_claims) claimBlock = "Too many claims are waiting for judgement; judge one first";

  return {
    submitClaim: claimBlock === null,
    claimBlock,
    myClaim: mine ?? null,
    cancel: open && same(wallet, bounty.sponsor) && !live,
    cancelBlockedByLiveClaim: open && same(wallet, bounty.sponsor) && live,
    refund: open && !beforeDeadline && (!live || (judgeDeadline !== null && now > judgeDeadline)),
  };
}

// Judge / re-judge for one claim. PENDING: anyone. REJECTED with attempts left: hunter only.
export function claimActions(bounty, claim, { wallet, now = Date.now() } = {}) {
  const judgeDeadline = ts(bounty.judge_deadline);
  const inWindow = judgeDeadline === null || now <= judgeDeadline;
  const base = bounty.status === "OPEN" && inWindow && claim.attempts < bounty.max_attempts;
  if (!base) return { judge: false, label: null, reason: null };
  if (claim.status === "PENDING") return { judge: true, label: "Judge", reason: null };
  if (claim.status === "REJECTED") {
    if (same(wallet, claim.hunter)) return { judge: true, label: "Re-judge", reason: null };
    return { judge: false, label: null, reason: "Only the hunter can ask for a re-judge" };
  }
  return { judge: false, label: null, reason: null };
}

// Pair each acceptance criterion with its judgement (if any).
export function criteriaWithResults(criteria, results) {
  return criteria.map((text, i) => ({
    text,
    pass: results?.[i] ? results[i].pass : null,
    reason: results?.[i]?.reason ?? "",
  }));
}

// ---------- inputs

const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const PR_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/pull\/(\d{1,9})\/?$/;
const ISSUE_URL_RE = /^https?:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/issues\/(\d{1,9})\/?(?:[#?].*)?$/;

// Accepts "owner/repo" or a pasted GitHub issue URL (which also fills the issue number).
export function parseRepoInput(text) {
  const s = String(text ?? "").trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const issue = ISSUE_URL_RE.exec(s);
  if (issue) return { repo: `${issue[1]}/${issue[2]}`, issue: Number(issue[3]) };
  const url = /^https?:\/\/github\.com\/([^/]+\/[^/]+)$/.exec(s);
  const repo = url ? url[1] : s;
  return { repo, issue: null };
}

export const isValidRepo = (repo) => REPO_RE.test(repo) && !repo.endsWith(".git");

// Same rule as the contract's _parse_pr_ref: a number, or a PR URL in the bounty repo.
export function parsePrRef(ref, repo) {
  const s = String(ref ?? "").trim();
  let n;
  if (/^\d+$/.test(s)) n = Number(s);
  else {
    const m = PR_URL_RE.exec(s);
    if (!m) throw new Error("Enter a PR number or https://github.com/<owner>/<repo>/pull/<n>");
    if (`${m[1]}/${m[2]}`.toLowerCase() !== String(repo).toLowerCase()) throw new Error(`That pull request is not in ${repo}`);
    n = Number(m[3]);
  }
  if (!(n >= 1 && n <= 999_999_999)) throw new Error("PR number out of range");
  return n;
}

export function parseCriteria(text) {
  return String(text ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").split(/\s+/).join(" ").trim())
    .filter(Boolean);
}

// Validates the create form like the contract does; returns { args, value } or throws.
export function buildCreateBounty(f, now = Date.now()) {
  const repo = String(f.repo ?? "").trim();
  if (!isValidRepo(repo)) throw new Error("Repository must look like owner/repo");
  const issue = Number(f.issue);
  if (!Number.isInteger(issue) || issue < 1 || issue > 999_999_999) throw new Error("Issue must be a positive number");
  const title = String(f.title ?? "").split(/\s+/).join(" ").trim();
  if (title.length < LIMITS.titleMin || title.length > LIMITS.titleMax) throw new Error(`Title must be ${LIMITS.titleMin}-${LIMITS.titleMax} characters`);
  const criteria = Array.isArray(f.criteria) ? f.criteria : parseCriteria(f.criteria);
  if (criteria.length < 1 || criteria.length > LIMITS.maxCriteria) throw new Error(`Give 1 to ${LIMITS.maxCriteria} acceptance criteria, one per line`);
  for (const c of criteria) {
    if (c.length < LIMITS.criterionMin || c.length > LIMITS.criterionMax) throw new Error(`Each criterion must be ${LIMITS.criterionMin}-${LIMITS.criterionMax} characters`);
  }
  const deadlineMs = f.deadline instanceof Date ? f.deadline.getTime() : Date.parse(f.deadline);
  if (Number.isNaN(deadlineMs)) throw new Error("Pick a deadline");
  if (deadlineMs <= now + 60_000) throw new Error("Deadline must be in the future");
  const grace = Number(f.graceHours);
  if (!Number.isInteger(grace) || grace < 0 || grace > LIMITS.maxGraceHours) throw new Error(`Judging grace must be 0-${LIMITS.maxGraceHours} hours`);
  const maxClaims = Number(f.maxClaims);
  if (!Number.isInteger(maxClaims) || maxClaims < 1 || maxClaims > LIMITS.maxClaims) throw new Error(`Max pending claims must be 1-${LIMITS.maxClaims}`);
  const maxAttempts = Number(f.maxAttempts);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > LIMITS.maxAttempts) throw new Error(`Max attempts must be 1-${LIMITS.maxAttempts}`);
  const value = parseGen(f.reward);
  if (value <= 0n) throw new Error("Reward must be more than 0");
  const deadline = new Date(deadlineMs).toISOString().replace(/\.\d+Z$/, "Z");
  return {
    args: [repo, issue, title, JSON.stringify(criteria), deadline, grace, maxClaims, maxAttempts],
    value,
  };
}

// What a hunter puts in the PR body: issue link + proof of authorship.
export function prBodySnippet(address, issue) {
  return `Closes #${issue}\n\nBounty payout address: ${address || "0xYOUR_WALLET_ADDRESS"}`;
}

// ---------- links

export const prUrl = (repo, n) => `https://github.com/${repo}/pull/${n}`;
export const commitUrl = (repo, sha) => `https://github.com/${repo}/commit/${sha}`;
export const repoUrl = (repo) => `https://github.com/${repo}`;

// ---------- results

// The judge() return arrives as GenLayer's "readable" calldata string, which is close to
// JSON but not always valid JSON. Pull out what the user needs either way.
export function summarizeJudgeResult(readable) {
  if (readable == null || readable === "") return null;
  const s = String(readable);
  let obj = null;
  try { obj = JSON.parse(s); } catch { obj = null; }
  const status = obj?.status ?? /"status"\s*:\s*"([A-Z_]+)"/.exec(s)?.[1] ?? null;
  if (!status) return s;
  if (status === "ACCEPTED") return "ACCEPTED: the reward was paid to the hunter.";
  if (status === "NOT_READY") return "NOT_READY: the pull request is still open. Nothing changed; judge again once it is merged.";
  if (status === "INCONCLUSIVE") return "INCONCLUSIVE: validators could not read GitHub or grade the PR. Nothing changed; try again.";
  if (status === "REJECTED") {
    const codes = obj?.codes ?? [...s.matchAll(/"([A-Z_]{6,})"/g)].map((m) => m[1]).filter((c) => c in CODE_TEXT);
    return `REJECTED${codes.length ? `: ${[...new Set(codes)].join(", ")}` : ""}.`;
  }
  return status;
}

// ---------- routing (hash based so any static host works without rewrites)

export function parseRoute(hash) {
  const h = String(hash ?? "").replace(/^#/, "").replace(/^\/+/, "");
  const m = /^bounty\/(\d+)$/.exec(h);
  if (m) return { name: "bounty", id: Number(m[1]) };
  if (h === "create") return { name: "create" };
  if (h === "how") return { name: "how" };
  return { name: "list" };
}

export const when = (iso) => {
  const t = ts(iso);
  return t === null ? "–" : new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

export function relative(iso, now = Date.now()) {
  const t = ts(iso);
  if (t === null) return "";
  const diff = t - now;
  const abs = Math.abs(diff);
  const units = [["day", 86400000], ["hour", 3600000], ["minute", 60000]];
  for (const [u, ms] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      return diff >= 0 ? `in ${n} ${u}${n > 1 ? "s" : ""}` : `${n} ${u}${n > 1 ? "s" : ""} ago`;
    }
  }
  return diff >= 0 ? "in under a minute" : "just now";
}
