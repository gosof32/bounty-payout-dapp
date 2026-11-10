// GET /api/badge?id=1[&format=json][&contract=0x...]
// Vercel Function (root /api directory, Web-standard GET export; zero config with the
// Vite preset). Reads get_stats/get_bounty from the Bounty Payout contract on GenLayer
// Studionet with a read-only genlayer-js client (no account, no key, no writes) and
// returns a shields-style SVG, or the shields.io endpoint JSON with format=json.
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { normalizeBounty } from "../src/lib/bounty.js";
import { badgeContent, badgeJson, badgeSvg } from "../src/lib/badge.js";
import { DEFAULT_CONTRACT } from "../src/config.js";

export const CACHE_OK = "public, max-age=60, s-maxage=60, stale-while-revalidate=300";
export const CACHE_ERROR = "public, max-age=30, s-maxage=30";

let client = null;
const readClient = () => (client ??= createClient({ chain: studionet }));

// Core, injectable for tests: returns { status, headers, body }.
export async function renderBadge(url, { read } = {}) {
  const u = new URL(url, "https://localhost");
  const rawId = (u.searchParams.get("id") ?? "").trim();
  const format = (u.searchParams.get("format") ?? "svg").toLowerCase();
  const contractParam = (u.searchParams.get("contract") ?? "").trim();
  const address = contractParam || process.env.VITE_CONTRACT_ADDRESS || DEFAULT_CONTRACT;
  const call = read ?? ((functionName, args) => readClient().readContract({ address, functionName, args }));

  let content;
  let error = null;
  if (contractParam && !/^0x[0-9a-fA-F]{40}$/.test(contractParam)) {
    error = "invalid contract";
  } else if (!/^\d{1,9}$/.test(rawId) || Number(rawId) < 1) {
    error = "invalid id";
  }
  const id = /^\d{1,9}$/.test(rawId) ? Number(rawId) : null;
  if (!error) {
    try {
      const stats = await call("get_stats", []);
      const total = Number(stats?.bounties ?? (stats instanceof Map ? stats.get("bounties") : 0));
      if (id > total) error = "not found";
      else content = badgeContent(normalizeBounty(await call("get_bounty", [id])));
    } catch (e) {
      error = /NOT_FOUND|unknown bounty/i.test(String(e?.message ?? e)) ? "not found" : "unavailable";
    }
  }
  if (error) content = badgeContent(null, { id, error });

  const headers = {
    "Cache-Control": error ? CACHE_ERROR : CACHE_OK,
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  };
  if (error) headers["X-Badge-Error"] = error;
  // Error badges are still 200 so they render in READMEs (GitHub's image proxy drops
  // non-2xx images) and so shields.io's endpoint badge accepts them.
  if (format === "json") {
    return { status: 200, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(badgeJson(content)) };
  }
  return { status: 200, headers: { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" }, body: badgeSvg(content) };
}

export async function GET(request) {
  const { status, headers, body } = await renderBadge(request.url);
  return new Response(body, { status, headers });
}
