"""Builds tests/parity/cases.json: inputs only. Expected outputs are recorded by running
the cases through the contract module itself:

    REGEN_PARITY=1 pytest tests/direct/test_parity.py

pytest then checks contract == recorded, and vitest (tests/frontend/parity.test.js)
checks the JS port in src/lib/preflight.js == recorded. Both must pass, so the JS
preflight and the contract agree on every case below.
"""
import copy
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SNAP = json.loads((HERE / "pr2.snapshot.json").read_text())
PR2, FILES2 = SNAP["pr"], SNAP["files"]

REPO = "gosof32/genlayer-bounty-payout"
HUNTER = "0xC27F966F8Dd499017dC5b17B2203013163b474a4"  # deployments/studionet.json accounts.hunter
OUTSIDER = "0x52B090BD9511874811D095e1e581CCb7Dc474F2D"  # accounts.outsider
# Bounty #1 / #2 / #3 windows as stored on Studionet (get_bounty).
B1 = ("2026-11-06T07:22:17Z", "2026-11-06T10:22:16Z")
B2 = ("2026-11-06T07:22:52Z", "2026-11-06T07:26:16Z")
B3 = ("2026-11-06T07:23:27Z", "2026-11-07T07:22:16Z")

A = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01"
ACME = "acme/widgets"

cases = []


def add(name, fn, *args):
    cases.append({"name": name, "fn": fn, "args": list(args)})


def pr(**over):
    p = copy.deepcopy(PR2)
    for k, v in over.items():
        if v is DEL:
            p.pop(k, None)
        else:
            p[k] = v
    return p


DEL = object()

# ---- _parse_pr_ref (same cases as tests/direct test_claim_by_number_and_url / test_bad_pr_ref, plus edges)
for ref in ["2", " 2 ", "\t42\n", "0", "1000000000", "999999999", "-3", "+3", "4.0", "", "  ",
            f"https://github.com/{REPO}/pull/2", f"https://github.com/{REPO}/pull/2/",
            f"https://github.com/{REPO.upper()}/pull/2", "https://github.com/other/repo/pull/2",
            f"http://github.com/{REPO}/pull/2", f"https://github.com/{REPO}/pull/2/files",
            f"https://github.com/{REPO}/pull/2#issuecomment-1", f"https://github.com/{REPO}/issues/1",
            f"https://github.com/{REPO}/pull/0", f"https://github.com/{REPO}/pull/1234567890",
            "\u0663", "\u00b2", "\uff11\uff12", f"https://github.com/{REPO}/pull/\u0663",
            "\u001c7\u001f", "\ufeff7", "7\u00a0", "pull/2", "#2"]:
    add(f"parse_pr_ref {ref!r}", "parse_pr_ref", ref, REPO)

# ---- _links_issue (tests/direct TestHelpers.test_links_issue + more)
for text in ["Closes #7", "see #7.", "fixes: acme/widgets#7", "Resolved https://github.com/acme/widgets/issues/7",
             "#70 and #17", "other/repo#7", "&#7;", "Fixes #7", "FIXED #7", "closed  #7", "close#7",
             "Closes\n#7", "Closes:\t#7", "Closes: #7", "Closes : #7", "preclose #7", "closesx #7",
             "Fix ACME/Widgets#7", "acme/widgets#77", "https://github.com/acme/widgets/issues/7/",
             "https://github.com/acme/widgets/issues/70", "issue#7", "x#7", "_#7", "/#7", "é#7", "(#7)",
             "#7\u0663", "#7x", "closes\u00a0#7", "closes\u001c#7", "closes\ufeff#7", "closes\u200b#7",
             "écloses #7", "closes_ #7", "Resolves #7", "resolve #7", "resolvesd #7", "fixe #7",
             "Closes #7.\n\nBody", "Refs #70 and issue7."]:
    add(f"links_issue {text!r}", "links_issue", text, ACME, 7)
add("links_issue real PR #2 title+body", "links_issue", PR2["title"] + "\n" + PR2["body"], REPO, 1)
add("links_issue dotted repo", "links_issue", "Closes my.org/re.po#3", "my.org/re.po", 3)
add("links_issue dot is not a wildcard", "links_issue", "Closes myXorg/re.po#3", "my.org/re.po", 3)

# ---- _has_address (TestHelpers.test_has_address + more)
for text in [f"pay {A.lower()} thanks", f"pay {A}9", "pay 0x00", f"pay {A}", f"pay {A.upper()}",
             f"x{A}", f"a{A}", f"{A}g", f"0{A}", f"{A[2:]}"]:
    add(f"has_address {text!r}", "has_address", text, A)
add("has_address real PR #2 hunter", "has_address", PR2["body"], HUNTER)
add("has_address real PR #2 outsider", "has_address", PR2["body"], OUTSIDER)

# ---- _parse_ts + _iso
for v in ["2026-11-06T07:24:12Z", "2026-11-06T07:24:12+07:00", "2026-11-06T07:24:12.999999Z",
          "2026-11-06 07:24:12Z", "2026-11-06T07:24Z", "2026-11-06T07Z", "2026-11-06Z", "2026-11-06T07:24:12",
          "2026-11-06T07:24:12-05:30", "20261106T072412Z", " 2026-11-06T07:24:12Z ", "2026-02-30T00:00:00Z",
          "2026-11-06T24:00:00Z", "not a date", "", "2026-11-06T07:24:12.5Z", "2026-11-06T07:24:12+0700",
          "2026-11-06+00:00", "2026-11-06+07:00", "2026-11-06", "20261106+0700", "2026-11-06T07+07",
          "2026-W45-5T07:00Z", "2026W455T07:00Z", "2026-W45T07:00Z", "2026-W53-1T00:00Z", "2020-W53-7T00:00Z",
          "2026-310T07:00Z", "2026-11-06T07:24:12.1234567Z", "2026-11-06T07:24:12,5Z", "2026-11-06t07:24Z",
          "2026-11-06x07:24Z", "2026-11-06T0724Z", "2026-11-06T07:2412Z", "2026-11-06T07:24:12+07:00:30",
          "2026-11-06T07:24:12+24:00", "2026-11-06T07:24:12+23:59", "2026-11-06T07:24:12-00:00",
          "2026-11-06T07:24:12+07:00,5", "2026-11-06T", "2024-02-29T00:00Z", "2023-02-29T00:00Z",
          "0001-01-01T00:00:00Z", "9999-12-31T23:59:59Z", "2026-11-06T07:24:12Z\n", "2026-11-06T7:24Z",
          "2026-11-06T07:24,5Z", "2026-11-06T07,5Z", "2026-11-06T07:24.5Z", "2026-11-06T07:24:12+07:00.5",
          "2026-11-06T07:24:12+07.5", "2026-11-06T072412.5Z", "2026-11-06T07:24:12.Z", "2026-11-06T07.Z"]:
    add(f"parse_ts {v!r}", "parse_ts", v)

# ---- _hard_facts on the real PR #2 payload and variants
add("hard_facts real PR #2 / hunter", "hard_facts", PR2, FILES2, REPO, 1, HUNTER)
add("hard_facts real PR #2 / outsider", "hard_facts", PR2, FILES2, REPO, 1, OUTSIDER)
add("hard_facts open PR", "hard_facts", pr(state="open", merged=False, merged_at=None, merge_commit_sha=None), FILES2, REPO, 1, HUNTER)
add("hard_facts closed unmerged", "hard_facts", pr(merged=False, merged_at=None), FILES2, REPO, 1, HUNTER)
add("hard_facts merged missing, merged_at set", "hard_facts", pr(merged=DEL), FILES2, REPO, 1, HUNTER)
add("hard_facts merged null, merged_at set", "hard_facts", pr(merged=None), FILES2, REPO, 1, HUNTER)
add("hard_facts merged false, merged_at set", "hard_facts", pr(merged=False), FILES2, REPO, 1, HUNTER)
add("hard_facts merged 'true' string", "hard_facts", pr(merged="true"), FILES2, REPO, 1, HUNTER)
add("hard_facts merged_at offset", "hard_facts", pr(merged_at="2026-11-06T14:24:12+07:00"), FILES2, REPO, 1, HUNTER)
add("hard_facts merged_at no tz", "hard_facts", pr(merged_at="2026-11-06T07:24:12"), FILES2, REPO, 1, HUNTER)
add("hard_facts base missing", "hard_facts", pr(base=None), FILES2, REPO, 1, HUNTER)
add("hard_facts base is a string", "hard_facts", pr(base="oops"), FILES2, REPO, 1, HUNTER)
add("hard_facts fork base", "hard_facts", pr(base={"repo": {"full_name": "Evil/Fork"}}), FILES2, REPO, 1, HUNTER)
add("hard_facts body null", "hard_facts", pr(body=None), FILES2, REPO, 1, HUNTER)
add("hard_facts link only in title", "hard_facts", pr(title="Fix (gosof32/genlayer-bounty-payout#1)", body=f"addr {HUNTER}"), FILES2, REPO, 1, HUNTER)
add("hard_facts address only in title", "hard_facts", pr(title=f"Closes #1 {HUNTER}", body="no address"), FILES2, REPO, 1, HUNTER)
add("hard_facts numeric title", "hard_facts", pr(title=5, body=f"Closes #1 {HUNTER}"), FILES2, REPO, 1, HUNTER)
add("hard_facts user missing", "hard_facts", pr(user=DEL, head=DEL), [], REPO, 1, HUNTER)
add("hard_facts not a dict", "hard_facts", [PR2], FILES2, REPO, 1, HUNTER)
add("hard_facts files not a list", "hard_facts", PR2, {"a": 1}, REPO, 1, HUNTER)

# ---- _hard_codes
def facts(**over):
    f = {"state": "closed", "merged": True, "base_repo": REPO, "merged_at": "2026-11-06T07:24:12Z", "author": "gosof32",
         "merge_sha": "b" * 40, "head_sha": "a" * 40, "links_issue": True, "closing_keyword": True, "has_address": True, "files": 1}
    f.update(over)
    return f

add("hard_codes all pass b1", "hard_codes", facts(), REPO, *B1)
add("hard_codes all pass b2", "hard_codes", facts(), REPO, *B2)
add("hard_codes all pass b3", "hard_codes", facts(), REPO, *B3)
add("hard_codes merged before", "hard_codes", facts(merged_at="2026-11-06T07:22:16Z"), REPO, *B1)
add("hard_codes merged at created", "hard_codes", facts(merged_at="2026-11-06T07:22:17Z"), REPO, *B1)
add("hard_codes merged at deadline", "hard_codes", facts(merged_at="2026-11-06T10:22:16Z"), REPO, *B1)
add("hard_codes merged after", "hard_codes", facts(merged_at="2026-11-06T10:22:17Z"), REPO, *B1)
add("hard_codes not merged", "hard_codes", facts(merged=False, merged_at=""), REPO, *B1)
add("hard_codes merged no merged_at", "hard_codes", facts(merged_at=""), REPO, *B1)
add("hard_codes wrong repo", "hard_codes", facts(base_repo="evil/fork"), REPO, *B1)
add("hard_codes repo case", "hard_codes", facts(base_repo=REPO), REPO.upper(), *B1)
add("hard_codes several", "hard_codes", facts(base_repo="evil/fork", links_issue=False, has_address=False), REPO, *B1)
add("hard_codes everything", "hard_codes", facts(merged=False, base_repo="x/y", links_issue=False, has_address=False), REPO, *B1)
add("hard_codes bad deadline", "hard_codes", facts(), REPO, B1[0], "tomorrow")

# ---- _judge_once (GitHub payloads in, kind + codes out; the LLM is mocked to pass all)
def jo(name, p, f, hunter, window, repo=REPO, issue=1):
    add(name, "judge_once", p, f, repo, issue, hunter, *window)

jo("judge_once real PR #2 vs bounty #1 / hunter (claim #2 ACCEPTED on-chain)", PR2, FILES2, HUNTER, B1)
jo("judge_once real PR #2 vs bounty #1 / outsider (claim #1 MISSING_AUTHORSHIP on-chain)", PR2, FILES2, OUTSIDER, B1)
jo("judge_once real PR #2 vs bounty #2 / hunter", PR2, FILES2, HUNTER, B2)
jo("judge_once real PR #2 vs bounty #3 / hunter", PR2, FILES2, HUNTER, B3)
jo("judge_once PR unreadable", None, None, HUNTER, B1)
jo("judge_once files unreadable", PR2, None, HUNTER, B1)
jo("judge_once open PR", pr(state="open", merged=False, merged_at=None), FILES2, HUNTER, B1)
jo("judge_once open PR but merged true", pr(state="open"), FILES2, HUNTER, B1)
jo("judge_once closed unmerged", pr(merged=False, merged_at=None), FILES2, HUNTER, B1)
jo("judge_once malformed base", pr(base="oops"), FILES2, HUNTER, B1)
jo("judge_once merged_at without tz", pr(merged_at="2026-11-06T07:24:12"), FILES2, HUNTER, B1)
jo("judge_once fork + no link + outsider", pr(base={"repo": {"full_name": "a/b"}}, title="x", body="nothing"), FILES2, OUTSIDER, B1)

(HERE / "cases.json").write_text(json.dumps({"cases": cases}, indent=1, ensure_ascii=True) + "\n")
print(len(cases), "cases")
