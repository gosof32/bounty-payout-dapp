import React from "react";
import { badgeContent, badgeSnippets, badgeSvg, svgDataUri } from "../lib/badge.js";
import { CONTRACT_ADDRESS, DEFAULT_CONTRACT } from "../config.js";
import CopyButton from "./CopyButton.jsx";
import Icon from "./Icons.jsx";

// "Embed badge": a live status badge (served by /api/badge) for READMEs and issues.
// The preview is rendered with the same generator the endpoint uses.
export default function EmbedBadge({ bounty, contract = CONTRACT_ADDRESS }) {
  const custom = contract && contract.toLowerCase() !== DEFAULT_CONTRACT.toLowerCase() ? contract : null;
  const s = badgeSnippets(bounty.id, { contract: custom });
  const preview = svgDataUri(badgeSvg(badgeContent(bounty)));
  const rows = [
    ["Markdown", s.markdown],
    ["HTML", s.html],
    ["Image URL", s.img],
  ];
  return (
    <section className="panel embed" aria-label="Embed badge">
      <h3><Icon name="sparkle" size={18} />Embed badge</h3>
      <p className="muted small">Put this bounty's live status in the issue or README. It links back to this page and refreshes about every minute.</p>
      <a className="embed-preview" href={s.page} target="_blank" rel="noreferrer"><img src={preview} alt={`Bounty #${bounty.id} badge preview`} /></a>
      {rows.map(([label, text]) => (
        <div key={label} className="embed-row">
          <div className="embed-head"><span className="field-label-text">{label}</span><CopyButton text={text} label={`Copy ${label}`} className="xs" /></div>
          <pre className="snippet embed-code" aria-label={`${label} snippet`}>{text}</pre>
        </div>
      ))}
      <p className="muted small">JSON for shields.io: <a href={s.json} target="_blank" rel="noreferrer" className="mono-link">?format=json</a></p>
    </section>
  );
}
