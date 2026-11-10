// JS side of the preflight parity check: every case in tests/parity/cases.json was
// recorded by running it through the contract module (tests/direct/test_parity.py).
// src/lib/preflight.js must produce exactly the same output for each one.
import { describe, it, expect } from "vitest";
import data from "../parity/cases.json";
import {
  ContractError, evaluate, hardCodes, hardFacts, hasAddress, isoUtc, linksIssue, parsePrRefContract, parseTs,
} from "../../src/lib/preflight.js";

const { cases } = data;

function run(fn, args) {
  try {
    switch (fn) {
      case "parse_pr_ref": return { ok: parsePrRefContract(...args) };
      case "links_issue": return { ok: linksIssue(...args) };
      case "has_address": return { ok: hasAddress(...args) };
      case "parse_ts": return { ok: isoUtc(parseTs(...args)) };
      case "hard_facts": return { ok: hardFacts(...args) };
      case "hard_codes": return { ok: hardCodes(...args) };
      case "judge_once": {
        const [pr, files, repo, issue, hunter, createdAt, deadline] = args;
        return { ok: evaluate({ pr, files, repo, issue, hunter, createdAt, deadline }) };
      }
      default: throw new Error(`unknown fn ${fn}`);
    }
  } catch (e) {
    if (e instanceof ContractError) return { error: e.message };
    return { raises: true };
  }
}

describe("preflight parity with contracts/bounty_payout.py", () => {
  it("has the recorded cases", () => {
    expect(cases.length).toBeGreaterThan(100);
    expect(cases.every((c) => c.expected)).toBe(true);
  });
  for (const c of cases) {
    it(c.name, () => {
      expect(run(c.fn, c.args)).toEqual(c.expected);
    });
  }
});
