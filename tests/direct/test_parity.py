"""Contract side of the preflight parity check.

Every case in tests/parity/cases.json is run through the contract's own pure helpers
(_parse_pr_ref, _links_issue, _has_address, _parse_ts/_iso, _hard_facts, _hard_codes)
and through _judge_once with GitHub mocked, and compared with the recorded `expected`.
tests/frontend/parity.test.js runs the same cases through src/lib/preflight.js against
the same `expected`, so the browser preflight cannot drift from the contract.

Re-record after changing cases:  REGEN_PARITY=1 pytest tests/direct/test_parity.py
"""
import json
import os
from pathlib import Path

import pytest

CASES_FILE = Path(__file__).resolve().parents[1] / "parity" / "cases.json"
DATA = json.loads(CASES_FILE.read_text())
CRITERIA = ["Adds a CONTRIBUTING.md file at the repository root"]


def run_case(module, vm, case, monkeypatch):
    fn, args = case["fn"], case["args"]
    try:
        if fn == "parse_pr_ref":
            return {"ok": module._parse_pr_ref(*args)}
        if fn == "links_issue":
            return {"ok": module._links_issue(*args)}
        if fn == "has_address":
            return {"ok": module._has_address(*args)}
        if fn == "parse_ts":
            return {"ok": module._iso(module._parse_ts(*args))}
        if fn == "hard_facts":
            return {"ok": module._hard_facts(*args)}
        if fn == "hard_codes":
            return {"ok": module._hard_codes(*args)}
        if fn == "judge_once":
            pr, files, repo, issue, hunter, created, deadline = args

            def fake_get_json(url):
                return files if "/files" in url else pr

            monkeypatch.setattr(module, "_get_json", fake_get_json)
            vm.mock_llm(r"ACCEPTANCE CRITERIA", json.dumps({"criteria": [{"id": 1, "pass": True, "reason": "ok"}]}))
            res = module._judge_once(repo, issue, 1, hunter, created, deadline, "t", CRITERIA)
            return {"ok": {k: res[k] for k in ("kind", "facts", "codes", "error") if k in res}}
    except module.gl.vm.UserError as e:
        msg = getattr(e, "message", None) or (e.args[0] if e.args else str(e))
        return {"error": str(msg)}
    except Exception:
        return {"raises": True}
    raise AssertionError(f"unknown fn {fn}")


def test_contract_matches_recorded_parity_cases(module, direct_vm, monkeypatch):
    regen = os.environ.get("REGEN_PARITY") == "1"
    mismatches = []
    for case in DATA["cases"]:
        got = run_case(module, direct_vm, case, monkeypatch)
        if regen:
            case["expected"] = got
        elif got != case.get("expected"):
            mismatches.append((case["name"], got, case.get("expected")))
    if regen:
        CASES_FILE.write_text(json.dumps(DATA, indent=1, ensure_ascii=True) + "\n")
    assert not mismatches, mismatches[:5]
    assert len(DATA["cases"]) > 100
