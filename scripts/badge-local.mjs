// Runs the /api/badge handler locally against live Studionet (read-only) and saves
// the outputs to docs/badges/.   node scripts/badge-local.mjs [ids...]
import { mkdirSync, writeFileSync } from "node:fs";
import { GET } from "../api/badge.js";

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ["1", "2", "3", "99"];
mkdirSync("docs/badges", { recursive: true });
for (const id of ids) {
  for (const format of ["svg", "json"]) {
    const res = await GET(new Request(`https://bounty-payout-dapp.vercel.app/api/badge?id=${id}${format === "json" ? "&format=json" : ""}`));
    const body = await res.text();
    const file = `docs/badges/bounty-${id}.${format}`;
    writeFileSync(file, body);
    console.log(`${file}  ${res.status}  ${res.headers.get("content-type")}  cache="${res.headers.get("cache-control")}"${res.headers.get("x-badge-error") ? `  error=${res.headers.get("x-badge-error")}` : ""}`);
    if (format === "json") console.log(`  ${body}`);
  }
}
