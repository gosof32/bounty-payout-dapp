// Read-only smoke test against the live contract on GenLayer Studionet.
// Uses the same read helpers as the app. No wallet, no key, no writes.
//   node scripts/smoke-read.mjs [contractAddress]
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { readBounties, readClaims, readStats, phaseOf, formatReward, bountyActions } from "../src/lib/bounty.js";

const address = process.argv[2] || process.env.VITE_CONTRACT_ADDRESS || "0xFb2372a7325F63Bb4f0a3330C075e9F58Fe7466A";
const client = createClient({ chain: studionet });

const stats = await readStats(client, address);
console.log(`contract ${address} on studionet: ${stats.bounties} bounties, ${stats.claims} claims`);
const bounties = await readBounties(client, address);
let ok = bounties.length === stats.bounties;
for (const b of bounties) {
  const claims = await readClaims(client, address, b.id);
  const can = bountyActions(b, { claims });
  console.log(`#${b.id} ${b.status.padEnd(9)} ${phaseOf(b).padEnd(9)} ${formatReward(b.reward).padEnd(16)} ${b.repo}#${b.issue} "${b.title}"  refundable=${can.refund}`);
  for (const c of claims) {
    const crit = c.criteria_results.map((r) => (r.pass ? "pass" : "fail")).join(",") || "-";
    console.log(`    claim #${c.id} ${c.status.padEnd(10)} PR #${c.pr_number} hunter ${c.hunter} codes=[${c.codes.join(",")}] criteria=[${crit}] ${c.pr_url}`);
  }
  if (claims.length !== b.claim_count) ok = false;
}
console.log(ok ? "SMOKE OK" : "SMOKE MISMATCH");
process.exit(ok ? 0 : 1);
