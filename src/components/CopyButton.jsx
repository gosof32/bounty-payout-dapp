import React, { useState } from "react";

export async function copyText(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  // Fallback for browsers without the async clipboard API (or insecure contexts).
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "absolute";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand?.("copy") ?? false;
  document.body.removeChild(ta);
  return ok;
}

export default function CopyButton({ text, label = "Copy", className = "" }) {
  const [state, setState] = useState("idle");
  const onClick = async () => {
    try {
      const ok = await copyText(text);
      setState(ok ? "done" : "fail");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 2000);
  };
  return (
    <button type="button" className={`copy ${className}`} onClick={onClick} aria-label={label}>
      {state === "done" ? "Copied ✓" : state === "fail" ? "Copy failed" : label}
    </button>
  );
}
