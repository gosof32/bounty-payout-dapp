# Bounty Payout dApp

**A web app for escrowed GitHub issue bounties that pay themselves out through GenLayer validator consensus.**

Contract on GenLayer Studionet: [`0xFb2372a7325F63Bb4f0a3330C075e9F58Fe7466A`](https://explorer-studio.genlayer.com/address/0xFb2372a7325F63Bb4f0a3330C075e9F58Fe7466A)
Contract primitive (standalone repo, 88 contract tests, full lifecycle record): https://github.com/gosof32/genlayer-bounty-payout

---

## What it is

Open-source bounties have a trust problem at the end: the sponsor decides whether the work counts, and the hunter has to trust they'll pay. Bounty Payout moves that decision into a GenLayer Intelligent Contract.

- A **sponsor** escrows GEN against one GitHub issue and 1-8 plain-text acceptance criteria.
- A **hunter** opens a PR that references the issue and carries their **wallet address in the PR body** (proof of authorship), then claims the bounty from that wallet.
- **Anyone** can ask the validators to judge the claim. Each validator reads the PR from the GitHub API. Contract code checks the hard facts (merged, right repo, inside the bounty window, issue linked, address present); only then does an LLM grade every criterion pass/fail with a reason. Validators must agree on every fact and every criterion.
- If everything passes, the reward is paid to the hunter **in the same transaction**. The sponsor can't veto it. No state leaves funds stuck: every bounty ends `PAID`, `CANCELLED` or `REFUNDED`.

This app is the frontend for that contract: browse bounties without a wallet, read exactly why a claim passed or failed, and post, claim, judge, cancel or refund from any EIP-1193 wallet.

## Features

- **Bounty list** with `OPEN` / `PAID` / `CANCELLED` / `REFUNDED` badges, status filters, reward, timeline phase (open, judging window, expired) and claim counts.
- **Bounty detail**: repo, issue link, criteria, reward, sponsor, created / deadline / judging-window times, links to the issue, the repo and the winning PR.
- **Claims** with status (`PENDING`, `ACCEPTED`, `REJECTED`, `SUPERSEDED`, `CLOSED`), hunter, PR link, PR author, merge time, merge commit link, evidence hash, rejection codes explained in plain English, and a **per-criterion pass/fail table with the validators' reasons**.
- **Post a bounty**: repo (or paste the issue URL to fill repo + issue), title, criteria one per line, reward sent as the call value, deadline, judging grace, claim and attempt limits. Inputs are validated with the contract's own rules before anything is signed.
- **Claim a bounty**: a helper that tells the hunter to put their wallet address in the PR body, with the exact lines (`Closes #N` + `Bounty payout address: 0x…`) and copy buttons. PR number or URL accepted, checked against the bounty repo.
- **Judge / Re-judge**: shown only when the contract would accept it (pending claim: anyone; rejected claim with attempts left: the hunter only; inside the judging window).
- **Cancel** (sponsor, no live claim) and **Refund** (anyone, after the deadline with no live claim, or after the judging window) shown only when the state machine allows them.
- **Transaction tracking**: *Sign in wallet → Submitted → Accepted by validators → Finalized*, explorer link, the judge verdict (ACCEPTED / REJECTED with codes / NOT_READY / INCONCLUSIVE) or the contract's revert reason. A transaction counts as done only when it is FINALIZED with validator agreement and a successful execution.
- **Read-only without a wallet.** Connecting adds and switches to GenLayer Studionet (chain 61999) with standard EIP-3085/3326 calls; "Get test GEN" funds the wallet on Studionet.
- Mobile-friendly layout, hash routing (`#/bounty/1`, `#/create`) so it works on any static host without rewrites.

## The live demo data

The reference contract holds three bounties, all run against the real GitHub API (details in [`deployments/studionet.json`](deployments/studionet.json)):

| Bounty | Status | What happened |
|---|---|---|
| #1 "Add a CONTRIBUTING guide" on [gosof32/genlayer-bounty-payout#1](https://github.com/gosof32/genlayer-bounty-payout/issues/1) | **PAID** | An outsider claimed [PR #2](https://github.com/gosof32/genlayer-bounty-payout/pull/2) → REJECTED `MISSING_AUTHORSHIP`, later SUPERSEDED. The real hunter claimed it → ACCEPTED, 3/3 criteria passed, paid in the same tx. |
| #2 "Refund demo" | **REFUNDED** | Nobody claimed; refunded to the sponsor after the deadline. |
| #3 "Cancel demo" | **CANCELLED** | Cancelled by the sponsor. |

Demo rewards are tiny amounts of test GEN, so the app shows them in wei.

## Run locally

```bash
npm install
npm run dev              # app at http://localhost:5173
npm test                 # 41 frontend tests (vitest + Testing Library)
npm run build            # production build into dist/
npm run smoke:studionet  # read-only check against the live contract (no wallet, no writes)

pip install -r requirements-dev.txt
npm run test:contract    # 88 contract tests (GenLayer direct mode, mocked GitHub + LLM)
```

Point the app at your own deployment with `VITE_CONTRACT_ADDRESS` (see `.env.example`). Without it, the app uses the reference deployment above.

## Deploy to Vercel

1. In Vercel, **Add New → Project** and import `gosof32/bounty-payout-dapp`.
2. Framework preset: **Vite** (build command `npm run build`, output directory `dist`; both are detected automatically).
3. Optional: add the environment variable `VITE_CONTRACT_ADDRESS` to use a different contract.
4. Deploy. No server, rewrites or secrets are needed: the app talks to Studionet's public RPC from the browser and the user's wallet signs.

The build uses relative asset paths (`base: "./"`), so `dist/` also works on GitHub Pages or any static host.

## Architecture

```
contracts/bounty_payout.py   the GenLayer Intelligent Contract (Python), same code as the deployed one
src/lib/bounty.js            reads, units, the bounty/claim state machine, input validation, result parsing
src/lib/wallet.js            wallet connect, Studionet switch, write → ACCEPTED → FINALIZED
src/lib/tx.js                receipt interpretation (status, consensus, execution, revert reason)
src/components/              BountyList, BountyDetail (claims, verdicts, claim form), CreateBounty, TxLog, CopyButton
scripts/smoke-read.mjs       read-only smoke test against the live contract
tests/frontend/              vitest: state machine, parsing, validation, receipts, and the App flows
tests/direct/                contract tests (GenLayer direct mode)
```

Contract API used by the app (from `contracts/bounty_payout.py`):

| Call | Kind | Used for |
|---|---|---|
| `get_stats()`, `list_bounties(offset, limit)` | view | bounty list (paged by 50) |
| `get_bounty(id)`, `get_claims(bounty_id)` | view | detail page |
| `create_bounty(repo, issue, title, criteria_json, deadline, judge_grace_hours, max_claims, max_attempts)` | payable write | post a bounty, reward = call value |
| `submit_claim(bounty_id, pr)` | write | claim with a PR number |
| `judge(claim_id)` | write | judge / re-judge via validator consensus |
| `cancel_bounty(bounty_id)`, `refund(bounty_id)` | write | return the reward to the sponsor |

The UI's action rules mirror the contract's guards exactly (see `bountyActions` / `claimActions` in `src/lib/bounty.js`), so a button only appears when the transaction can succeed; the contract still enforces every rule.

## Limits

- Public repositories only: validators read the unauthenticated GitHub API.
- Authorship is "the PR body carries your address". A maintainer who edits PR bodies could redirect a bounty, so post bounties on repos whose maintainers you trust.
- One reward per bounty, paid in full to the first accepted claim.
- Studionet test GEN has no value.

## License

MIT
