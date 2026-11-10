// Shields-style status badge for a bounty: "bounty #1 | PAID 100,000,000 wei".
// Pure functions, shared by the Vercel function (api/badge.js) and the in-app
// "Embed badge" preview, so the preview is byte-identical to what /api/badge serves.
import { formatReward } from "./bounty.js";

export const SITE_URL = "https://bounty-payout-dapp.vercel.app";

export const STATUS_COLORS = {
  OPEN: "#2ea043", // green: claimable
  PAID: "#0969da", // blue: paid to a hunter
  CANCELLED: "#8b949e", // grey: sponsor took it back before any claim
  REFUNDED: "#bf8700", // amber: expired, returned to the sponsor
};
export const ERROR_COLOR = "#cf222e";
const LABEL_COLOR = "#555";

// Verdana 11px advance widths (px) for the characters a badge can contain; the SVG
// also sets textLength so any fallback font is stretched to exactly this width.
const W = {
  " ": 3.87, "#": 9.0, ",": 3.91, ".": 3.91, "-": 4.62, "_": 7.0, ":": 4.79, "/": 4.9, "(": 5.0, ")": 5.0, "?": 6.0, "!": 4.5,
  0: 7.0, 1: 7.0, 2: 7.0, 3: 7.0, 4: 7.0, 5: 7.0, 6: 7.0, 7: 7.0, 8: 7.0, 9: 7.0,
  a: 6.58, b: 6.85, c: 5.73, d: 6.85, e: 6.55, f: 3.87, g: 6.85, h: 6.96, i: 3.02, j: 3.79, k: 6.51, l: 3.02, m: 10.7,
  n: 6.96, o: 6.68, p: 6.85, q: 6.85, r: 4.69, s: 5.73, t: 4.33, u: 6.96, v: 6.51, w: 9.0, x: 6.51, y: 6.51, z: 5.64,
  A: 7.52, B: 7.54, C: 7.68, D: 8.47, E: 6.95, F: 6.33, G: 8.52, H: 8.27, I: 4.63, J: 4.94, K: 7.65, L: 6.2, M: 9.31,
  N: 8.21, O: 8.66, P: 6.72, Q: 8.66, R: 7.65, S: 7.54, T: 6.73, U: 8.05, V: 7.52, W: 10.88, X: 7.56, Y: 6.73, Z: 7.54,
};

export function textWidth(text) {
  let w = 0;
  for (const ch of String(text)) w += W[ch] ?? 7.0;
  return Math.round(w * 10) / 10;
}

export const escapeXml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// Label/message/color for a normalized bounty (see normalizeBounty), or an error badge.
export function badgeContent(bounty, { id, error } = {}) {
  if (error || !bounty) {
    return { label: id ? `bounty #${id}` : "bounty", message: error || "not found", color: ERROR_COLOR, isError: true };
  }
  const status = String(bounty.status || "").toUpperCase();
  return {
    label: `bounty #${bounty.id}`,
    message: `${status} ${formatReward(bounty.reward)}`,
    color: STATUS_COLORS[status] ?? "#6e7781",
    isError: false,
  };
}

// Flat shields.io-style SVG, 20px high.
export function badgeSvg({ label, message, color }) {
  const pad = 6;
  const lw = Math.ceil(textWidth(label) + pad * 2);
  const mw = Math.ceil(textWidth(message) + pad * 2);
  const total = lw + mw;
  const l = escapeXml(label);
  const m = escapeXml(message);
  const c = escapeXml(color);
  // Text is drawn at 10x scale (shields' trick) for crisper rendering at small sizes.
  const lx = (lw / 2) * 10;
  const mx = (lw + mw / 2) * 10;
  const ltl = Math.round((lw - pad * 2) * 10);
  const mtl = Math.round((mw - pad * 2) * 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${l}: ${m}">` +
    `<title>${l}: ${m}</title>` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
    `<clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="${LABEL_COLOR}"/><rect x="${lw}" width="${mw}" height="20" fill="${c}"/><rect width="${total}" height="20" fill="url(#s)"/></g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">` +
    `<text aria-hidden="true" x="${lx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${ltl}">${l}</text>` +
    `<text x="${lx}" y="140" transform="scale(.1)" fill="#fff" textLength="${ltl}">${l}</text>` +
    `<text aria-hidden="true" x="${mx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${mtl}">${m}</text>` +
    `<text x="${mx}" y="140" transform="scale(.1)" fill="#fff" textLength="${mtl}">${m}</text>` +
    `</g></svg>`;
}

// shields.io "endpoint" schema, so https://img.shields.io/endpoint?url=... works too.
export function badgeJson({ label, message, color, isError }) {
  const out = { schemaVersion: 1, label, message, color };
  if (isError) out.isError = true;
  return out;
}

export const svgDataUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// Snippets for the "Embed badge" panel. `contract` is added only for non-default deployments.
export function badgeSnippets(id, { site = SITE_URL, contract = null } = {}) {
  const q = `id=${id}${contract ? `&contract=${contract}` : ""}`;
  const img = `${site}/api/badge?${q}`;
  const page = `${site}/#/bounty/${id}`;
  const json = `${site}/api/badge?${q}&format=json`;
  return {
    img,
    page,
    json,
    markdown: `[![Bounty #${id}](${img})](${page})`,
    html: `<a href="${page}"><img src="${img}" alt="Bounty #${id}"></a>`,
    shields: `[![Bounty #${id}](https://img.shields.io/endpoint?url=${encodeURIComponent(json)})](${page})`,
  };
}
