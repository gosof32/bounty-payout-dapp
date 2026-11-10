import { describe, it, expect, vi } from "vitest";

vi.mock("genlayer-js", () => ({ createClient: () => ({}) }));
vi.mock("genlayer-js/chains", () => ({ studionet: { id: 61999 } }));

const { badgeContent, badgeJson, badgeSnippets, badgeSvg, escapeXml, textWidth, STATUS_COLORS, ERROR_COLOR } = await import("../../src/lib/badge.js");
const { renderBadge, GET, CACHE_OK, CACHE_ERROR } = await import("../../api/badge.js");
const { bounty } = await import("./fixtures.js");

const raw = (status, over = {}) => ({ id: 1, status, reward: 100000000, repo: "gosof32/genlayer-bounty-payout", issue: 1, criteria: [], ...over });
const reader = (bounties, { fail } = {}) => vi.fn(async (fn, args) => {
  if (fail) throw new Error(fail);
  if (fn === "get_stats") return { bounties: bounties.length, claims: 0 };
  return bounties[args[0] - 1];
});

describe("badge generator", () => {
  it("labels and colours each status", () => {
    for (const s of ["OPEN", "PAID", "CANCELLED", "REFUNDED"]) {
      const c = badgeContent(bounty({ status: s }));
      expect(c).toEqual({ label: "bounty #1", message: `${s} 100,000,000 wei`, color: STATUS_COLORS[s], isError: false });
    }
    expect(new Set(Object.values(STATUS_COLORS)).size).toBe(4);
    expect(badgeContent(bounty({ status: "OPEN", reward: 25n * 10n ** 17n })).message).toBe("OPEN 2.5 GEN");
  });

  it("renders a well-formed SVG with matching widths, title and aria label", () => {
    const svg = badgeSvg(badgeContent(bounty({ status: "PAID" })));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain("<title>bounty #1: PAID 100,000,000 wei</title>");
    expect(svg).toContain('aria-label="bounty #1: PAID 100,000,000 wei"');
    expect(svg).toContain(`fill="${STATUS_COLORS.PAID}"`);
    const total = Number(/width="(\d+)" height="20"/.exec(svg)[1]);
    const lw = Math.ceil(textWidth("bounty #1") + 12);
    const mw = Math.ceil(textWidth("PAID 100,000,000 wei") + 12);
    expect(total).toBe(lw + mw);
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.querySelectorAll("text")).toHaveLength(4);
  });

  it("escapes XML and builds error badges", () => {
    expect(escapeXml(`<a&"'>`)).toBe("&lt;a&amp;&quot;&apos;&gt;");
    const e = badgeContent(null, { id: 99, error: "not found" });
    expect(e).toEqual({ label: "bounty #99", message: "not found", color: ERROR_COLOR, isError: true });
    expect(badgeSvg({ label: "<x>", message: "a&b", color: "#000" })).toContain("&lt;x&gt;: a&amp;b");
    expect(badgeJson(e)).toEqual({ schemaVersion: 1, label: "bounty #99", message: "not found", color: ERROR_COLOR, isError: true });
    expect(badgeJson(badgeContent(bounty({ status: "OPEN" })))).not.toHaveProperty("isError");
  });

  it("builds embed snippets pointing at the bounty page", () => {
    const s = badgeSnippets(1);
    expect(s.markdown).toBe("[![Bounty #1](https://bounty-payout-dapp.vercel.app/api/badge?id=1)](https://bounty-payout-dapp.vercel.app/#/bounty/1)");
    expect(s.html).toBe('<a href="https://bounty-payout-dapp.vercel.app/#/bounty/1"><img src="https://bounty-payout-dapp.vercel.app/api/badge?id=1" alt="Bounty #1"></a>');
    expect(s.shields).toContain("https://img.shields.io/endpoint?url=" + encodeURIComponent("https://bounty-payout-dapp.vercel.app/api/badge?id=1&format=json"));
    expect(badgeSnippets(2, { contract: "0x" + "a".repeat(40) }).img).toBe(`https://bounty-payout-dapp.vercel.app/api/badge?id=2&contract=0x${"a".repeat(40)}`);
  });
});

describe("/api/badge handler", () => {
  it("serves the SVG for a bounty with a short CDN cache", async () => {
    const read = reader([raw("PAID")]);
    const out = await renderBadge("/api/badge?id=1", { read });
    expect(out.status).toBe(200);
    expect(out.headers["Content-Type"]).toBe("image/svg+xml; charset=utf-8");
    expect(out.headers["Cache-Control"]).toBe(CACHE_OK);
    expect(CACHE_OK).toContain("s-maxage=60");
    expect(out.body).toContain("PAID 100,000,000 wei");
    expect(read.mock.calls.map((c) => c[0])).toEqual(["get_stats", "get_bounty"]);
  });

  it("serves shields endpoint JSON with format=json", async () => {
    const out = await renderBadge("/api/badge?id=2&format=json", { read: reader([raw("PAID"), raw("REFUNDED", { id: 2, reward: 50000000 })]) });
    expect(out.headers["Content-Type"]).toMatch(/application\/json/);
    expect(JSON.parse(out.body)).toEqual({ schemaVersion: 1, label: "bounty #2", message: "REFUNDED 50,000,000 wei", color: STATUS_COLORS.REFUNDED });
  });

  it("answers an unknown id with an error badge, without calling get_bounty", async () => {
    const read = reader([raw("PAID")]);
    const out = await renderBadge("/api/badge?id=99", { read });
    expect(out.status).toBe(200);
    expect(out.headers["X-Badge-Error"]).toBe("not found");
    expect(out.headers["Cache-Control"]).toBe(CACHE_ERROR);
    expect(out.body).toContain("bounty #99: not found");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("rejects bad input and survives RPC failures", async () => {
    for (const q of ["", "?id=abc", "?id=0", "?id=-1", "?id=1e3", "?id=1234567890"]) {
      const out = await renderBadge(`/api/badge${q}`, { read: reader([]) });
      expect(out.headers["X-Badge-Error"]).toBe("invalid id");
    }
    expect((await renderBadge("/api/badge?id=1&contract=0x12", { read: reader([]) })).headers["X-Badge-Error"]).toBe("invalid contract");
    expect((await renderBadge("/api/badge?id=1", { read: reader([], { fail: "fetch failed" }) })).headers["X-Badge-Error"]).toBe("unavailable");
    expect((await renderBadge("/api/badge?id=1", { read: reader([], { fail: "[NOT_FOUND] unknown bounty" }) })).headers["X-Badge-Error"]).toBe("not found");
  });

  it("exports a Web-standard GET for Vercel", async () => {
    expect(typeof GET).toBe("function");
  });
});
