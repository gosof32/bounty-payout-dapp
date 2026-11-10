// Runs the claim preflight (src/lib/preflight.js) on the live data: every claim on the
// Studionet contract is re-checked against the real GitHub API and compared with the
// rejection codes the validators recorded on-chain. Read-only (view calls + GitHub GETs).
//   node scripts/preflight-live.mjs [contractAddress]
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { readBounties, readClaims } from "../src/lib/bounty.js";
import { evaluate, fetchPullRequest, verdict } from "../src/lib/preflight.js";

const address = process.argv[2] || process.env.VITE_CONTRACT_ADDRESS || "0xFb2372a7325F63Bb4f0a3330C075e9F58Fe7466A";
const client = createClient({ chain: studionet });
const bounties = await readBounties(client, address);
let ok = true;
const check = async (b, n, hunter) => {
  const gh = await fetchPullRequest(b.repo, n);
  return evaluate({ pr: gh.pr, files: gh.files, repo: b.repo, issue: b.issue, hunter, createdAt: b.created_at, deadline: b.deadline });
};
for (const b of bounties.sort((x, y) => x.id - y.id)) {
  const claims = await readClaims(client, address, b.id);
  console.log(`bounty #${b.id} ${b.status} ${b.repo}#${b.issue} window ${b.created_at} .. ${b.deadline}`);
  for (const c of claims) {
    const r = await check(b, c.pr_number, c.hunter);
    const hard = c.codes.filter((x) => x !== "CRITERIA_NOT_MET");
    const same = r.kind === "JUDGED" && JSON.stringify(r.codes) === JSON.stringify(hard);
    if (!same) ok = false;
    console.log(`  claim #${c.id} PR #${c.pr_number} hunter ${c.hunter} on-chain ${c.status} codes=[${c.codes}]  preflight ${r.kind} codes=[${r.codes ?? r.error}]  ${same ? "MATCH" : "DIFF"}`);
    console.log(`    ${verdict(r, { hunter: c.hunter }).text}`);
  }
  if (b.id === 1) {
    const r = await check(b, 1, "");
    console.log(`  PR #1 (an issue, not a PR): preflight ${r.kind} ${r.error ?? ""}`);
  }
}
console.log(ok ? "PREFLIGHT MATCHES ON-CHAIN" : "PREFLIGHT MISMATCH");
process.exit(ok ? 0 : 1);
