// Shapes copied from the live Studionet contract (get_bounty / get_claims), see deployments/studionet.json.
import { normalizeBounty, normalizeClaim } from "../../src/lib/bounty.js";

export const SPONSOR = "0xc083933576e30d24AD6c16658e78a4d124c82aac";
export const HUNTER = "0xC27F966F8Dd499017dC5b17B2203013163b474a4";
export const OUTSIDER = "0x52B090BD9511874811D095e1e581CCb7Dc474F2D";
export const H = 3600000;

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");

export function rawBounty(over = {}, now = Date.now()) {
  return {
    id: 1,
    sponsor: SPONSOR,
    repo: "gosof32/genlayer-bounty-payout",
    issue: 1,
    issue_url: "https://github.com/gosof32/genlayer-bounty-payout/issues/1",
    title: "Add a CONTRIBUTING guide",
    criteria: [
      "Adds a CONTRIBUTING.md file at the repository root",
      "CONTRIBUTING.md explains how to install the dev requirements and run the direct-mode tests with pytest",
      "CONTRIBUTING.md explains how to run the Studionet lifecycle script",
    ],
    reward: 100000000,
    created_at: iso(now - 2 * H),
    deadline: iso(now + 3 * H),
    judge_deadline: iso(now + 6 * H),
    max_claims: 3,
    max_attempts: 2,
    status: "OPEN",
    winner_claim: 0,
    claim_count: 0,
    has_live_claim: false,
    closed_at: "",
    ...over,
  };
}

export const bounty = (over, now) => normalizeBounty(rawBounty(over, now));

export function rawClaim(over = {}) {
  return {
    id: 2,
    bounty_id: 1,
    hunter: HUNTER,
    pr_number: 2,
    pr_url: "https://github.com/gosof32/genlayer-bounty-payout/pull/2",
    status: "PENDING",
    attempts: 0,
    attempts_left: 2,
    submitted_at: iso(Date.now() - H),
    judged_at: "",
    pr_author: "",
    merged_at: "",
    merge_sha: "",
    head_sha: "",
    codes: [],
    criteria_results: [],
    evidence_hash: "",
    paid: 0,
    ...over,
  };
}

export const claim = (over) => normalizeClaim(rawClaim(over));

export const ACCEPTED = {
  status: "ACCEPTED",
  attempts: 1,
  attempts_left: 1,
  judged_at: "2026-11-06T07:29:00Z",
  pr_author: "gosof32",
  merged_at: "2026-11-06T07:24:12Z",
  merge_sha: "b80824e68ae763f2ee42b5fe1ff22b95b7eaf0ed",
  head_sha: "fb4ba7ef81fe671e8494082ffc705559cc477dd2",
  criteria_results: [
    { pass: true, reason: "CONTRIBUTING.md is added at the repository root." },
    { pass: true, reason: "Explains installation of dev requirements and running direct-mode tests with pytest." },
    { pass: true, reason: "Explains how to run the Studionet lifecycle script (setup and judge)." },
  ],
  evidence_hash: "8e4b6c9494bf44e86e7169c0c90e59706cc8de000af7634bd050b66d100abceb",
  paid: 100000000,
};
