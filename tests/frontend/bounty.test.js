import { describe, it, expect, vi } from "vitest";
import {
  parseGen, formatGen, formatReward, plain, normalizeBounty, normalizeClaim, readBounties, readClaims, phaseOf,
  isLiveClaim, hasLiveClaim, bountyActions, claimActions, criteriaWithResults, parseRepoInput, isValidRepo, parsePrRef,
  parseCriteria, buildCreateBounty, prBodySnippet, summarizeJudgeResult, parseRoute, relative,
} from "../../src/lib/bounty.js";
import { bounty, claim, rawBounty, rawClaim, SPONSOR, HUNTER, OUTSIDER, H, ACCEPTED } from "./fixtures.js";

const WEI = 10n ** 18n;
const NOW = Date.parse("2026-11-06T08:00:00Z");

describe("units", () => {
  it("parses and formats GEN with 18 decimals", () => {
    expect(parseGen("2.5")).toBe(25n * 10n ** 17n);
    expect(formatGen(1234n * WEI)).toBe("1,234");
    expect(() => parseGen("abc")).toThrow();
    expect(() => parseGen("-1")).toThrow();
  });
  it("shows tiny demo rewards in wei instead of 0 GEN", () => {
    expect(formatReward(100000000n)).toBe("100,000,000 wei");
    expect(formatReward(25n * 10n ** 17n)).toBe("2.5 GEN");
    expect(formatReward(0n)).toBe("0 GEN");
  });
});

describe("normalization", () => {
  it("turns genlayer-js Maps into plain objects", () => {
    const m = new Map([["a", new Map([["b", 1n]])], ["c", [new Map([["d", "x"]])]]]);
    expect(plain(m)).toEqual({ a: { b: 1n }, c: [{ d: "x" }] });
  });
  it("normalizes a bounty from Map/BigInt calldata", () => {
    const raw = new Map(Object.entries({ ...rawBounty(), id: 4n, reward: 5n * WEI, max_attempts: 2n, claim_count: 1n }));
    const b = normalizeBounty(raw);
    expect(b.id).toBe(4);
    expect(b.reward).toBe(5n * WEI);
    expect(b.max_attempts).toBe(2);
    expect(b.criteria).toHaveLength(3);
  });
  it("normalizes a claim, including criteria results and codes", () => {
    const c = normalizeClaim(rawClaim({ ...ACCEPTED }));
    expect(c.paid).toBe(100000000n);
    expect(c.criteria_results[0]).toEqual({ pass: true, reason: "CONTRIBUTING.md is added at the repository root." });
    const j = normalizeClaim(rawClaim({ codes: '["MISSING_AUTHORSHIP"]', criteria_results: "[]" }));
    expect(j.codes).toEqual(["MISSING_AUTHORSHIP"]);
  });
  it("derives the issue URL when missing", () => {
    expect(normalizeBounty(rawBounty({ issue_url: "", repo: "acme/w", issue: 7 })).issue_url).toBe("https://github.com/acme/w/issues/7");
  });
});

describe("reads", () => {
  it("pages list_bounties by get_stats and sorts newest first", async () => {
    const calls = [];
    const client = {
      readContract: vi.fn(async ({ functionName, args }) => {
        calls.push([functionName, args]);
        if (functionName === "get_stats") return new Map([["bounties", 52n], ["claims", 0n]]);
        const [offset, limit] = args;
        return Array.from({ length: Math.min(limit, 52 - offset) }, (_, i) => rawBounty({ id: offset + i + 1 }));
      }),
    };
    const list = await readBounties(client, "0xC");
    expect(list).toHaveLength(52);
    expect(list[0].id).toBe(52);
    expect(calls.filter(([f]) => f === "list_bounties").map(([, a]) => a)).toEqual([[0, 50], [50, 50]]);
  });
  it("reads claims of a bounty in id order", async () => {
    const client = { readContract: vi.fn(async () => [rawClaim({ id: 3 }), rawClaim({ id: 1 })]) };
    const list = await readClaims(client, "0xC", 1);
    expect(list.map((c) => c.id)).toEqual([1, 3]);
    expect(client.readContract).toHaveBeenCalledWith({ address: "0xC", functionName: "get_claims", args: [1] });
  });
});

describe("state machine", () => {
  it("computes the phase of an open bounty from the clock", () => {
    const b = bounty({}, NOW);
    expect(phaseOf(b, NOW)).toBe("OPEN");
    expect(phaseOf(b, NOW + 4 * H)).toBe("JUDGING");
    expect(phaseOf(b, NOW + 7 * H)).toBe("EXPIRED");
    expect(phaseOf(bounty({ status: "PAID" }, NOW), NOW)).toBe("PAID");
  });

  it("treats PENDING and REJECTED-with-attempts as live claims", () => {
    const b = bounty({}, NOW);
    expect(isLiveClaim(b, claim({ status: "PENDING" }))).toBe(true);
    expect(isLiveClaim(b, claim({ status: "REJECTED", attempts: 1 }))).toBe(true);
    expect(isLiveClaim(b, claim({ status: "REJECTED", attempts: 2 }))).toBe(false);
    expect(isLiveClaim(b, claim({ status: "SUPERSEDED" }))).toBe(false);
    expect(hasLiveClaim(bounty({ has_live_claim: true }, NOW))).toBe(true);
    expect(hasLiveClaim(bounty({ status: "PAID", has_live_claim: true }, NOW))).toBe(false);
  });

  it("lets only the sponsor cancel, and only with no live claim", () => {
    const b = bounty({}, NOW);
    expect(bountyActions(b, { wallet: SPONSOR.toLowerCase(), claims: [], now: NOW }).cancel).toBe(true);
    expect(bountyActions(b, { wallet: OUTSIDER, claims: [], now: NOW }).cancel).toBe(false);
    expect(bountyActions(b, { wallet: null, claims: [], now: NOW }).cancel).toBe(false);
    const locked = bountyActions(b, { wallet: SPONSOR, claims: [claim()], now: NOW });
    expect(locked.cancel).toBe(false);
    expect(locked.cancelBlockedByLiveClaim).toBe(true);
    expect(bountyActions(bounty({ status: "PAID" }, NOW), { wallet: SPONSOR, claims: [], now: NOW }).cancel).toBe(false);
  });

  it("offers refund after the deadline with no live claim, or after the judging window", () => {
    const b = bounty({}, NOW);
    expect(bountyActions(b, { claims: [], now: NOW }).refund).toBe(false);
    expect(bountyActions(b, { claims: [], now: NOW + 4 * H }).refund).toBe(true);
    expect(bountyActions(b, { claims: [claim()], now: NOW + 4 * H }).refund).toBe(false);
    expect(bountyActions(b, { claims: [claim()], now: NOW + 7 * H }).refund).toBe(true);
    expect(bountyActions(bounty({ status: "REFUNDED" }, NOW), { claims: [], now: NOW + 7 * H }).refund).toBe(false);
  });

  it("allows a claim before the deadline, once per wallet, under the pending cap", () => {
    const b = bounty({ max_claims: 2 }, NOW);
    expect(bountyActions(b, { wallet: HUNTER, claims: [], now: NOW }).submitClaim).toBe(true);
    const dup = bountyActions(b, { wallet: HUNTER.toLowerCase(), claims: [claim()], now: NOW });
    expect(dup.submitClaim).toBe(false);
    expect(dup.myClaim.id).toBe(2);
    const full = bountyActions(b, { wallet: OUTSIDER, claims: [claim({ id: 1, hunter: "0x1" }), claim({ id: 2, hunter: "0x2" })], now: NOW });
    expect(full.claimBlock).toMatch(/Too many claims/);
    expect(bountyActions(b, { wallet: HUNTER, claims: [], now: NOW + 4 * H }).claimBlock).toMatch(/deadline/);
  });

  it("judge: anyone on PENDING, only the hunter on REJECTED, never after the window", () => {
    const b = bounty({}, NOW);
    expect(claimActions(b, claim(), { wallet: null, now: NOW })).toMatchObject({ judge: true, label: "Judge" });
    const rej = claim({ status: "REJECTED", attempts: 1 });
    expect(claimActions(b, rej, { wallet: OUTSIDER, now: NOW })).toMatchObject({ judge: false, reason: expect.stringMatching(/hunter/) });
    expect(claimActions(b, rej, { wallet: HUNTER.toLowerCase(), now: NOW })).toMatchObject({ judge: true, label: "Re-judge" });
    expect(claimActions(b, claim({ status: "REJECTED", attempts: 2 }), { wallet: HUNTER, now: NOW }).judge).toBe(false);
    expect(claimActions(b, claim(), { now: NOW + 7 * H }).judge).toBe(false);
    expect(claimActions(bounty({ status: "PAID" }, NOW), claim(), { now: NOW }).judge).toBe(false);
    expect(claimActions(b, claim({ status: "ACCEPTED" }), { now: NOW }).judge).toBe(false);
  });

  it("pairs criteria with judgement results", () => {
    const rows = criteriaWithResults(["a", "b"], [{ pass: true, reason: "ok" }]);
    expect(rows).toEqual([{ text: "a", pass: true, reason: "ok" }, { text: "b", pass: null, reason: "" }]);
  });
});

describe("inputs", () => {
  it("reads owner/repo or a pasted issue URL", () => {
    expect(parseRepoInput("acme/widgets")).toEqual({ repo: "acme/widgets", issue: null });
    expect(parseRepoInput("https://github.com/acme/widgets/issues/7")).toEqual({ repo: "acme/widgets", issue: 7 });
    expect(parseRepoInput("https://github.com/acme/widgets.git")).toEqual({ repo: "acme/widgets", issue: null });
    expect(isValidRepo("acme/widgets")).toBe(true);
    expect(isValidRepo("not a repo")).toBe(false);
    expect(isValidRepo("-bad/x")).toBe(false);
  });

  it("parses a PR reference with the contract's rules", () => {
    expect(parsePrRef("42", "acme/w")).toBe(42);
    expect(parsePrRef(" https://github.com/Acme/W/pull/9/ ", "acme/w")).toBe(9);
    expect(() => parsePrRef("https://github.com/other/w/pull/9", "acme/w")).toThrow(/not in acme\/w/);
    expect(() => parsePrRef("#9", "acme/w")).toThrow();
    expect(() => parsePrRef("0", "acme/w")).toThrow(/range/);
  });

  it("splits criteria one per line and strips bullets", () => {
    expect(parseCriteria("- Adds a flag\n\n2. Has   a test\n• Docs")).toEqual(["Adds a flag", "Has a test", "Docs"]);
  });

  it("builds create_bounty args in contract order with the reward as value", () => {
    const deadline = new Date(NOW + 48 * H);
    const { args, value } = buildCreateBounty({
      repo: " acme/widgets ", issue: "7", title: "Add  dry run", criteria: "Adds a flag\nHas a test", reward: "2.5",
      deadline, graceHours: "72", maxClaims: "3", maxAttempts: "2",
    }, NOW);
    expect(args).toEqual(["acme/widgets", 7, "Add dry run", '["Adds a flag","Has a test"]', "2026-11-08T08:00:00Z", 72, 3, 2]);
    expect(value).toBe(25n * 10n ** 17n);
  });

  it("rejects create inputs the contract would revert on", () => {
    const ok = { repo: "acme/w", issue: "7", title: "Title", criteria: "Adds a flag", reward: "1", deadline: new Date(NOW + 48 * H), graceHours: "72", maxClaims: "3", maxAttempts: "2" };
    const bad = (over) => () => buildCreateBounty({ ...ok, ...over }, NOW);
    expect(bad({ repo: "acme" })).toThrow(/owner\/repo/);
    expect(bad({ issue: "0" })).toThrow(/Issue/);
    expect(bad({ title: "ab" })).toThrow(/Title/);
    expect(bad({ criteria: "" })).toThrow(/criteria/);
    expect(bad({ criteria: "ab" })).toThrow(/3-200/);
    expect(bad({ criteria: Array(9).fill("criterion").join("\n") })).toThrow(/1 to 8/);
    expect(bad({ deadline: new Date(NOW - H) })).toThrow(/future/);
    expect(bad({ graceHours: "337" })).toThrow(/0-336/);
    expect(bad({ maxClaims: "21" })).toThrow(/1-20/);
    expect(bad({ maxAttempts: "6" })).toThrow(/1-5/);
    expect(bad({ reward: "0" })).toThrow(/more than 0/);
  });

  it("builds the PR body lines with the hunter address", () => {
    expect(prBodySnippet(HUNTER, 7)).toBe(`Closes #7\n\nBounty payout address: ${HUNTER}`);
    expect(prBodySnippet(null, 7)).toMatch(/0xYOUR_WALLET_ADDRESS/);
  });
});

describe("results and routing", () => {
  it("summarizes judge() results, including GenLayer's non-JSON readable form", () => {
    expect(summarizeJudgeResult('{"attempts_left":1"codes":["MISSING_AUTHORSHIP",]"criteria":[]"status":"REJECTED"}')).toBe("REJECTED: MISSING_AUTHORSHIP.");
    expect(summarizeJudgeResult('{"status":"ACCEPTED","paid":100}')).toMatch(/^ACCEPTED/);
    expect(summarizeJudgeResult('{"status":"NOT_READY","detail":"pull request is still open"}')).toMatch(/still open/);
    expect(summarizeJudgeResult('{"status":"INCONCLUSIVE","error":"x"}')).toMatch(/try again/);
    expect(summarizeJudgeResult("")).toBeNull();
  });

  it("parses hash routes", () => {
    expect(parseRoute("#/bounty/12")).toEqual({ name: "bounty", id: 12 });
    expect(parseRoute("#/create")).toEqual({ name: "create" });
    expect(parseRoute("#/how")).toEqual({ name: "how" });
    expect(parseRoute("")).toEqual({ name: "list" });
    expect(parseRoute("#/bounty/abc")).toEqual({ name: "list" });
  });

  it("formats relative times", () => {
    expect(relative("2026-11-06T11:00:00Z", NOW)).toBe("in 3 hours");
    expect(relative("2026-11-04T08:00:00Z", NOW)).toBe("2 days ago");
    expect(relative("garbage", NOW)).toBe("");
  });
});
