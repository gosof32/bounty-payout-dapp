// Claim preflight: a line-by-line JS port of the contract's hard-fact checks
// (contracts/bounty_payout.py: _parse_pr_ref, _links_issue, _has_address, _parse_ts,
// _iso, _hard_facts, _hard_codes and the NOT_READY / INCONCLUSIVE branches of
// _judge_once). It runs in the browser on the same public GitHub REST payload the
// validators read, so a hunter can see "this claim would be rejected with X" before
// signing anything. It never touches the chain.
//
// Parity with the Python is enforced by tests/parity/cases.json: pytest runs every case
// through the contract module, vitest runs it through this file, and both must equal
// the same recorded expectation (see tests/direct/test_parity.py and
// tests/frontend/parity.test.js).
//
// Python regex semantics are reproduced explicitly, because JS differs by default:
//   \w  -> [\p{L}\p{N}_]   (Python str patterns are Unicode-aware)
//   \b  -> lookarounds on that class
//   \d  -> \p{Nd}
//   \s  -> Python's whitespace set (includes \x1c-\x1f and \x85, excludes \ufeff)

// ---------- contract constants (keep in sync with contracts/bounty_payout.py)

export const R_NOT_MERGED = "NOT_MERGED";
export const R_WRONG_REPO = "WRONG_REPO";
export const R_MERGED_BEFORE = "MERGED_BEFORE_BOUNTY";
export const R_MERGED_AFTER = "MERGED_AFTER_DEADLINE";
export const R_ISSUE_NOT_LINKED = "ISSUE_NOT_LINKED";
export const R_NO_AUTHORSHIP = "MISSING_AUTHORSHIP";
export const HARD_CODES = [R_NOT_MERGED, R_WRONG_REPO, R_MERGED_BEFORE, R_MERGED_AFTER, R_ISSUE_NOT_LINKED, R_NO_AUTHORSHIP];

export const K_JUDGED = "JUDGED";
export const K_NOT_READY = "NOT_READY";
export const K_INCONCLUSIVE = "INCONCLUSIVE";

export const GITHUB_API = "https://api.github.com";

// gl.vm.UserError equivalent: message is exactly the contract's.
export class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContractError";
  }
}

// ---------- Python string / regex helpers

const PY_WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const WS = `[${PY_WS}]`;
const W = "[\\p{L}\\p{N}_]";
const NOT_W_BEHIND = `(?<!${W})`;
const NOT_W_AHEAD = `(?!${W})`;
const ND = "\\p{Nd}";

// str.strip() with no arguments.
export function pyStrip(s) {
  return String(s).replace(new RegExp(`^${WS}+|${WS}+$`, "gu"), "");
}

// Python truthiness of a JSON value.
export function pyTruthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

const isDict = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function pyRepr(v) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : pyFloat(v);
  if (typeof v === "string") return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  return `{${Object.entries(v).map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(", ")}}`;
}

function pyFloat(n) {
  if (Number.isNaN(n)) return "nan";
  if (!Number.isFinite(n)) return n > 0 ? "inf" : "-inf";
  const s = String(n);
  return /[.e]/.test(s) ? s.replace(/e\+?/, "e+").replace("e+-", "e-") : `${s}.0`;
}

// str(x) for a JSON value (strings as is, True/False/None, ints, lists/dicts as repr).
export function pyStr(v) {
  if (typeof v === "string") return v;
  return pyRepr(v);
}

// str(x or "")
const strOr = (v) => (pyTruthy(v) ? pyStr(v) : "");

// (x or {}) followed by .get(...): a truthy non-dict raises AttributeError in Python.
function dictOr(v) {
  if (!pyTruthy(v)) return {};
  if (!isDict(v)) throw new TypeError("not a dict");
  return v;
}

// re.escape for the characters that can appear in a validated owner/repo or an address.
const reEscape = (s) => String(s).replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

// Value of a string of Unicode decimal digits, like Python's int() on an isdigit() string.
// Nd digits come in contiguous runs of ten (0..9), so the value is the offset in its run.
const ND_ONE = new RegExp(`^${ND}$`, "u");
function ndValue(ch) {
  const cp = ch.codePointAt(0);
  let start = cp;
  while (start - 1 >= 0 && ND_ONE.test(String.fromCodePoint(start - 1)) && cp - (start - 1) < 10) start -= 1;
  return (cp - start) % 10;
}
function pyIntOfDigits(s) {
  let n = 0n;
  for (const ch of s) {
    if (!ND_ONE.test(ch)) throw new TypeError("invalid literal for int()"); // e.g. superscripts: isdigit() but not decimal
    n = n * 10n + BigInt(ndValue(ch));
  }
  return n;
}
// str.isdigit(): Nd plus the "digit" No characters (superscripts, circled digits...).
const ISDIGIT_RE = /^(?:\p{Nd}|[\u00b2\u00b3\u00b9\u1369-\u1371\u19da\u2070\u2074-\u2079\u2080-\u2089\u2460-\u2468\u2474-\u247c\u2488-\u2490\u24ea\u24f5-\u24fd\u24ff\u2776-\u277e\u2780-\u2788\u278a-\u2792\u{10a40}-\u{10a43}\u{10e60}-\u{10e68}\u{11052}-\u{1105a}\u{1f100}-\u{1f10a}])+$/u;

// ---------- contract helpers, ported

const PR_URL_RE = new RegExp(`^https://github\\.com/([A-Za-z0-9-]{1,39})/([A-Za-z0-9._-]{1,100})/pull/(${ND}{1,9})/?$`, "u");

// _parse_pr_ref(ref, repo) -> int, or throws ContractError with the contract's message.
export function parsePrRefContract(ref, repo) {
  const s = pyStrip(pyStr(ref));
  let n;
  if (s.length > 0 && ISDIGIT_RE.test(s)) {
    n = pyIntOfDigits(s);
  } else {
    // Python's $ also matches before one trailing "\n"; strip() has already removed it.
    const m = PR_URL_RE.exec(s);
    if (m === null) throw new ContractError("[INVALID] pr must be a number or https://github.com/<owner>/<repo>/pull/<n>");
    if (`${m[1]}/${m[2]}`.toLowerCase() !== String(repo).toLowerCase()) {
      throw new ContractError("[INVALID] pull request is not in the bounty repository");
    }
    n = pyIntOfDigits(m[3]);
  }
  if (!(n >= 1n && n <= 999_999_999n)) throw new ContractError("[INVALID] pr number out of range");
  return Number(n);
}

// _links_issue(text, repo, issue) -> { links, closing }
export function linksIssue(text, repo, issue) {
  const n = String(issue);
  const r = reEscape(String(repo).toLowerCase());
  const t = String(text).toLowerCase();
  const ref = `(?:(?<![\\p{L}\\p{N}_/#&])#${n}|${r}#${n}|https://github\\.com/${r}/issues/${n})(?!${ND})`;
  const links = new RegExp(ref, "u").test(t);
  const closing = new RegExp(`${NOT_W_BEHIND}(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)${NOT_W_AHEAD}:?${WS}+${ref}`, "u").test(t);
  return { links, closing };
}

// _has_address(text, address_hex) -> bool
export function hasAddress(text, addressHex) {
  const a = reEscape(String(addressHex).toLowerCase());
  return new RegExp(`(?<![0-9a-f])${a}(?![0-9a-f])`).test(String(text).toLowerCase());
}

// datetime.fromisoformat as in CPython 3.11+: a date (YYYY-MM-DD, YYYYMMDD or an ISO week
// date), then optionally ANY single separator character and a time HH[[:]MM[[:]SS[(.|,)f+]]]
// with an optional ±HH[[:]MM[[:]SS[.f+]]] offset. Fractions beyond 6 digits are truncated.
// Returns epoch microseconds as BigInt; throws ContractError like the contract's _parse_ts.
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const DIG = /^[0-9]+$/;

function epochDay(y, m, d) {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  return Math.round(dt.getTime() / 86_400_000);
}

function parseIsoDate(ds, bad) {
  if (ds.length === 10 && ds[4] === "-" && ds[7] === "-" && DIG.test(ds.slice(0, 4) + ds.slice(5, 7) + ds.slice(8))) {
    return dayOf(+ds.slice(0, 4), +ds.slice(5, 7), +ds.slice(8), bad);
  }
  if (ds.length === 8 && DIG.test(ds)) return dayOf(+ds.slice(0, 4), +ds.slice(4, 6), +ds.slice(6), bad);
  const w = /^(\d{4})(-?)W(\d{2})(?:\2(\d))?$/.exec(ds);
  if (w) {
    const y = +w[1], wk = +w[3], wd = w[4] === undefined ? 1 : +w[4];
    const jan4 = epochDay(y, 1, 4);
    const jan4wd = ((jan4 % 7) + 7 + 3) % 7; // 0 = Monday (1970-01-01 was a Thursday)
    const dec28 = epochDay(y, 12, 28);
    const weeks = Math.floor((dec28 - (jan4 - jan4wd)) / 7) + 1;
    if (y < 1 || wk < 1 || wk > weeks || wd < 1 || wd > 7) throw bad();
    return jan4 - jan4wd + (wk - 1) * 7 + (wd - 1);
  }
  throw bad();
}

function dayOf(y, m, d, bad) {
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw bad();
  return epochDay(y, m, d);
}

// HH[[:]MM[[:]SS]] followed by an optional (.|,)digits fraction, which CPython always reads
// as microseconds whichever component it follows. -> microseconds
function parseHms(ts, bad) {
  const m = /^(\d{2})(?:(:?)(\d{2})(?:\2(\d{2}))?)?(?:[.,](\d*))?$/.exec(ts);
  if (!m) throw bad();
  const H = +m[1], M = +(m[3] ?? 0), S = +(m[4] ?? 0);
  if (H > 23 || M > 59 || S > 59) throw bad();
  const us = BigInt((m[5] ?? "").slice(0, 6).padEnd(6, "0"));
  return (BigInt(H) * 3600n + BigInt(M) * 60n + BigInt(S)) * 1_000_000n + us;
}

export function parseTs(value) {
  const bad = () => new ContractError("[INVALID] timestamps must be ISO 8601, e.g. 2026-12-31T23:59:59Z");
  const s = pyStrip(pyStr(value)).replaceAll("Z", "+00:00");
  if (s.length < 7) throw bad();
  let dateLen;
  if (s[4] === "-") dateLen = s[5] === "W" ? (s[8] === "-" ? 10 : 8) : 10;
  else if (s[4] === "W") dateLen = s.length > 7 && /[0-9]/.test(s[7]) ? 8 : 7;
  else dateLen = 8;
  const day = parseIsoDate(s.slice(0, dateLen), bad);
  if (s.length === dateLen) throw new ContractError("[INVALID] timestamps need a timezone, e.g. a trailing Z");
  const rest = s.slice(dateLen + 1); // any single separator character
  if (rest === "") throw bad();
  const tzAt = rest.search(/[+-]/);
  const timePart = tzAt === -1 ? rest : rest.slice(0, tzAt);
  const tod = parseHms(timePart, bad);
  if (tzAt === -1) throw new ContractError("[INVALID] timestamps need a timezone, e.g. a trailing Z");
  const sign = rest[tzAt] === "-" ? -1n : 1n;
  const off = parseHms(rest.slice(tzAt + 1), bad);
  if (off >= 86_400_000_000n) throw bad();
  return BigInt(day) * 86_400_000_000n + tod - sign * off;
}

// _iso(ts): UTC, microseconds dropped, trailing Z.
export function isoUtc(us) {
  const secs = us >= 0n ? us / 1_000_000n : -((-us + 999_999n) / 1_000_000n);
  return new Date(Number(secs) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// _hard_facts(pr, files, repo, issue, hunter_hex). Throws on a payload the contract
// could not process (which makes _judge_once return INCONCLUSIVE).
export function hardFacts(pr, files, repo, issue, hunterHex) {
  if (!isDict(pr) || !Array.isArray(files)) throw new Error("malformed");
  const base = dictOr(pr.base);
  const baseRepo = strOr(dictOr(base.repo).full_name).toLowerCase();
  const title = strOr(pr.title);
  const body = strOr(pr.body);
  const link = linksIssue(`${title}\n${body}`, repo, issue);
  let mergedAt = pyTruthy(pr.merged_at) ? pr.merged_at : "";
  if (pyTruthy(mergedAt)) mergedAt = isoUtc(parseTs(mergedAt));
  const mergedRaw = pr.merged;
  return {
    state: strOr(pr.state),
    merged: mergedRaw === true || ((mergedRaw === null || mergedRaw === undefined) && pyTruthy(mergedAt)),
    base_repo: baseRepo,
    merged_at: mergedAt,
    author: strOr(dictOr(pr.user).login),
    merge_sha: strOr(pr.merge_commit_sha),
    head_sha: strOr(dictOr(pr.head).sha),
    links_issue: link.links,
    closing_keyword: link.closing,
    has_address: hasAddress(body, hunterHex),
    files: files.length,
  };
}

// _hard_codes(facts, repo, created_at, deadline) -> list of rejection codes, in contract order.
export function hardCodes(facts, repo, createdAt, deadline) {
  const codes = [];
  if (!facts.merged) codes.push(R_NOT_MERGED);
  if (facts.base_repo !== String(repo).toLowerCase()) codes.push(R_WRONG_REPO);
  if (facts.merged && facts.merged_at) {
    const m = parseTs(facts.merged_at);
    if (m < parseTs(createdAt)) codes.push(R_MERGED_BEFORE);
    if (m > parseTs(deadline)) codes.push(R_MERGED_AFTER);
  }
  if (!facts.links_issue) codes.push(R_ISSUE_NOT_LINKED);
  if (!facts.has_address) codes.push(R_NO_AUTHORSHIP);
  return codes;
}

// The deterministic part of _judge_once, given what GitHub returned (pr / files are
// null when the read failed). Grading by the LLM is not simulated: "JUDGED" with no codes
// means the hard checks pass and the criteria would go to the validators' model next.
export function evaluate({ pr, files, repo, issue, hunter, createdAt, deadline }) {
  if (!isDict(pr)) return { kind: K_INCONCLUSIVE, error: "could not read the pull request" };
  if (!Array.isArray(files)) return { kind: K_INCONCLUSIVE, error: "could not read the changed files" };
  let facts;
  try {
    facts = hardFacts(pr, files, repo, issue, hunter);
  } catch {
    return { kind: K_INCONCLUSIVE, error: "unexpected pull request payload" };
  }
  if (facts.state === "open" && !facts.merged) return { kind: K_NOT_READY, facts, codes: [] };
  return { kind: K_JUDGED, facts, codes: hardCodes(facts, repo, createdAt, deadline) };
}

// ---------- GitHub (public REST API, unauthenticated, same URLs as the contract)

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// Every 0x + 40 hex address written in a text (for "the PR body names these wallets").
export function findAddresses(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)) {
    if (!out.some((a) => a.toLowerCase() === m[0].toLowerCase())) out.push(m[0]);
  }
  return out;
}

export class RateLimitError extends Error {
  constructor(resetAt) {
    super("GitHub's public API rate limit is used up for this network");
    this.name = "RateLimitError";
    this.resetAt = resetAt; // Date or null
  }
}

const HEADERS = { Accept: "application/vnd.github+json" };

async function getJson(url, fetchImpl) {
  let resp;
  try {
    resp = await fetchImpl(url, { headers: HEADERS });
  } catch (e) {
    return { status: 0, error: e?.message ?? String(e) };
  }
  const remaining = resp.headers?.get?.("x-ratelimit-remaining");
  if (resp.status === 429 || (resp.status === 403 && (remaining === "0" || remaining === null))) {
    const reset = Number(resp.headers?.get?.("x-ratelimit-reset"));
    throw new RateLimitError(Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : null);
  }
  if (resp.status !== 200) return { status: resp.status };
  try {
    return { status: 200, json: await resp.json() };
  } catch {
    return { status: 200, json: undefined };
  }
}

const cache = new Map();

// Reads GET /repos/{repo}/pulls/{n} and /files?per_page=100 like the validators do.
// Returns { pr, files, prStatus, filesStatus } where pr/files are null when unreadable.
// Throws RateLimitError on a 403/429 rate-limit answer. Results are cached for 60 s.
export async function fetchPullRequest(repo, number, { fetch: fetchImpl = globalThis.fetch, now = Date.now(), useCache = true } = {}) {
  const key = `${String(repo).toLowerCase()}#${number}`;
  const hit = cache.get(key);
  if (useCache && hit && now - hit.at < 60_000) return hit.value;
  const base = `${GITHUB_API}/repos/${repo}/pulls/${number}`;
  const p = await getJson(base, fetchImpl);
  const pr = p.status === 200 && isDict(p.json) ? p.json : null;
  let files = null;
  let filesStatus = null;
  if (pr) {
    const f = await getJson(`${base}/files?per_page=100`, fetchImpl);
    filesStatus = f.status;
    files = f.status === 200 && Array.isArray(f.json) ? f.json : null;
  }
  const value = { pr, files, prStatus: p.status, filesStatus };
  if (useCache) cache.set(key, { at: now, value });
  return value;
}

export function clearPullRequestCache() {
  cache.clear();
}

// ---------- the checklist the UI shows

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

// Turns an evaluate() result into rows: { key, label, pass (true|false|null), detail }.
export function checklist(result, { repo, issue, hunter, createdAt, deadline, fmt = (x) => x } = {}) {
  if (!result || result.kind === K_INCONCLUSIVE || !result.facts) return [];
  const f = result.facts;
  const codes = new Set(result.codes ?? []);
  const merged = f.merged;
  const rows = [
    {
      key: "merged", code: R_NOT_MERGED, label: "Merged",
      pass: result.kind === K_NOT_READY ? null : !codes.has(R_NOT_MERGED),
      detail: merged ? `Merged ${fmt(f.merged_at)}${f.author ? ` · author @${f.author}` : ""}` : f.state === "open" ? "Still open: judging returns NOT_READY and uses no attempt" : "Closed without being merged",
    },
    {
      key: "repo", code: R_WRONG_REPO, label: `Merged into ${repo}`,
      pass: !codes.has(R_WRONG_REPO), detail: f.base_repo ? `Base repository: ${f.base_repo}` : "No base repository in the payload",
    },
    {
      key: "window", code: `${R_MERGED_BEFORE}/${R_MERGED_AFTER}`, label: "Merged inside the bounty window",
      pass: merged && f.merged_at ? !(codes.has(R_MERGED_BEFORE) || codes.has(R_MERGED_AFTER)) : null,
      detail: `${fmt(createdAt)} → ${fmt(deadline)}${codes.has(R_MERGED_BEFORE) ? " · merged before the bounty existed" : codes.has(R_MERGED_AFTER) ? " · merged after the deadline" : merged ? "" : " · checked once merged"}`,
    },
    {
      key: "issue", code: R_ISSUE_NOT_LINKED, label: `Links issue #${issue}`,
      pass: f.links_issue,
      detail: f.links_issue ? (f.closing_keyword ? "Found a closing reference (Closes/Fixes/Resolves)" : "Referenced (a closing keyword like \"Closes\" is recommended, not required)") : `Add "Closes #${issue}" to the title or body`,
    },
    {
      key: "address", code: R_NO_AUTHORSHIP, label: "Hunter address in the PR body",
      pass: hunter ? f.has_address : null,
      detail: hunter ? (f.has_address ? `${short(hunter)} found in the body` : `${short(hunter)} is not in the body`) : "Enter or connect the hunter's wallet to check authorship",
    },
  ];
  return rows;
}

// One-line verdict for the checklist header.
export function verdict(result, { hunter } = {}) {
  if (!result) return null;
  if (result.kind === K_INCONCLUSIVE) return { tone: "warn", text: `Validators would return INCONCLUSIVE: ${result.error}. Nothing would change on-chain.` };
  if (result.kind === K_NOT_READY) return { tone: "warn", text: "The PR is still open: judging would return NOT_READY (no attempt used). Merge it, then judge." };
  let codes = result.codes;
  if (!hunter) codes = codes.filter((c) => c !== R_NO_AUTHORSHIP);
  if (codes.length > 0) return { tone: "fail", codes, text: `This claim would be rejected with ${codes.join(", ")}.` };
  if (!hunter) return { tone: "warn", text: "Hard checks pass so far; authorship not checked without a hunter address." };
  return { tone: "pass", text: "All hard checks pass. Validators would now grade the acceptance criteria with an LLM (not simulated here)." };
}
