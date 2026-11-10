// Preflight: GitHub fetching (rate limits, 404s, caching), the checklist and verdicts,
// on the real PR #2 payload of gosof32/genlayer-bounty-payout (tests/parity/pr2.snapshot.json)
// against bounty #1's on-chain window. Cases mirror the contract tests in tests/direct.
import { describe, it, expect, vi, beforeEach } from "vitest";
import snap from "../parity/pr2.snapshot.json";
import {
  RateLimitError, checklist, clearPullRequestCache, evaluate, fetchPullRequest, findAddresses, verdict,
} from "../../src/lib/preflight.js";
import { HUNTER, OUTSIDER } from "./fixtures.js";

const REPO = "gosof32/genlayer-bounty-payout";
const B1 = { repo: REPO, issue: 1, createdAt: "2026-11-06T07:22:17Z", deadline: "2026-11-06T10:22:16Z" };
const run = (over = {}, hunter = HUNTER, b = B1) => evaluate({ pr: { ...snap.pr, ...over }, files: snap.files, hunter, ...b });

function res(status, body, headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { status, headers: { get: (k) => h.get(k.toLowerCase()) ?? null }, json: async () => body };
}

beforeEach(() => clearPullRequestCache());

describe("evaluate on the real PR #2 vs bounty #1", () => {
  it("passes every hard check for the hunter (claim #2 was ACCEPTED on-chain)", () => {
    const r = run();
    expect(r.kind).toBe("JUDGED");
    expect(r.codes).toEqual([]);
    expect(r.facts).toMatchObject({ merged: true, merged_at: "2026-11-06T07:24:12Z", author: "gosof32", links_issue: true, closing_keyword: true, has_address: true, files: 1 });
    expect(verdict(r, { hunter: HUNTER }).tone).toBe("pass");
  });

  it("rejects the outsider with MISSING_AUTHORSHIP only (claim #1 on-chain)", () => {
    const r = run({}, OUTSIDER);
    expect(r.codes).toEqual(["MISSING_AUTHORSHIP"]);
    const v = verdict(r, { hunter: OUTSIDER });
    expect(v.tone).toBe("fail");
    expect(v.text).toBe("This claim would be rejected with MISSING_AUTHORSHIP.");
    const rows = checklist(r, { ...B1, hunter: OUTSIDER });
    expect(rows.map((x) => [x.key, x.pass])).toEqual([["merged", true], ["repo", true], ["window", true], ["issue", true], ["address", false]]);
  });

  it("mirrors the contract's rejection cases", () => {
    expect(run({ merged: false, merged_at: null }).codes).toEqual(["NOT_MERGED"]);
    expect(run({ base: { repo: { full_name: "evil/fork" } } }).codes).toEqual(["WRONG_REPO"]);
    expect(run({ body: "Closes #1" }).codes).toEqual(["MISSING_AUTHORSHIP"]);
    expect(run({ body: `Closes #1 ${HUNTER}ff` }).codes).toEqual(["MISSING_AUTHORSHIP"]);
    expect(run({ title: "x", body: `Refs #10 and issue1. ${HUNTER}` }).codes).toEqual(["ISSUE_NOT_LINKED"]);
    expect(run({ merged_at: "2026-11-06T11:00:00Z" }).codes).toEqual(["MERGED_AFTER_DEADLINE"]);
    expect(run({ merged_at: "2026-10-01T00:00:00Z" }).codes).toEqual(["MERGED_BEFORE_BOUNTY"]);
    expect(run({ base: { repo: { full_name: "evil/fork" } }, title: "x", body: "nothing" }).codes).toEqual(["WRONG_REPO", "ISSUE_NOT_LINKED", "MISSING_AUTHORSHIP"]);
    expect(run({ title: `Add dry run (${REPO}#1)`, body: `addr ${HUNTER}` }).codes).toEqual([]);
  });

  it("an open PR is NOT_READY and a missing PR is INCONCLUSIVE, like _judge_once", () => {
    const open = run({ state: "open", merged: false, merged_at: null });
    expect(open.kind).toBe("NOT_READY");
    expect(verdict(open).text).toMatch(/NOT_READY/);
    expect(checklist(open, { ...B1, hunter: HUNTER })[0].pass).toBe(null);
    const missing = evaluate({ pr: null, files: null, hunter: HUNTER, ...B1 });
    expect(missing).toEqual({ kind: "INCONCLUSIVE", error: "could not read the pull request" });
    expect(verdict(missing).text).toMatch(/INCONCLUSIVE/);
  });

  it("without a hunter address it skips authorship instead of failing it", () => {
    const r = run({}, "");
    expect(verdict(r, { hunter: "" })).toMatchObject({ tone: "warn" });
    expect(checklist(r, { ...B1, hunter: "" }).find((x) => x.key === "address").pass).toBe(null);
  });

  it("finds the addresses written in a PR body", () => {
    expect(findAddresses(snap.pr.body)).toEqual([HUNTER]);
    expect(findAddresses(`a ${HUNTER} b ${HUNTER.toLowerCase()} ${OUTSIDER}ff`)).toEqual([HUNTER]);
  });
});

describe("fetchPullRequest", () => {
  it("reads the PR and its files from the same URLs as the contract", async () => {
    const fetch = vi.fn(async (url) => res(200, url.endsWith("/files?per_page=100") ? snap.files : snap.pr));
    const out = await fetchPullRequest(REPO, 2, { fetch });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      `https://api.github.com/repos/${REPO}/pulls/2`,
      `https://api.github.com/repos/${REPO}/pulls/2/files?per_page=100`,
    ]);
    expect(out.pr.number).toBe(2);
    expect(out.files).toHaveLength(1);
    await fetchPullRequest(REPO, 2, { fetch });
    expect(fetch).toHaveBeenCalledTimes(2); // cached
  });

  it("turns a 403 rate-limit answer into RateLimitError with the reset time", async () => {
    const fetch = vi.fn(async () => res(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1794326801" }));
    const err = await fetchPullRequest(REPO, 2, { fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.resetAt.getTime()).toBe(1794326801000);
    const fetch429 = vi.fn(async () => res(429, {}));
    await expect(fetchPullRequest(REPO, 3, { fetch: fetch429 })).rejects.toBeInstanceOf(RateLimitError);
  });

  it("a 404 PR gives pr: null without reading files", async () => {
    const fetch = vi.fn(async () => res(404, { message: "Not Found" }, { "x-ratelimit-remaining": "59" }));
    const out = await fetchPullRequest(REPO, 1, { fetch });
    expect(out).toEqual({ pr: null, files: null, prStatus: 404, filesStatus: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a 403 that is not a rate limit is just an unreadable PR", async () => {
    const fetch = vi.fn(async () => res(403, {}, { "x-ratelimit-remaining": "40" }));
    expect((await fetchPullRequest(REPO, 4, { fetch })).pr).toBe(null);
  });
});
