// UI: claim preflight in the claim form, and the read-only "Check a PR" tool.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("genlayer-js", () => ({ createClient: () => ({}) }));
vi.mock("genlayer-js/chains", () => ({ studionet: { id: 61999, name: "studionet" } }));

const { default: App } = await import("../../src/App.jsx");
const { RateLimitError, clearPullRequestCache } = await import("../../src/lib/preflight.js");
const { bounty, claim, HUNTER, OUTSIDER, H } = await import("./fixtures.js");
const snap = (await import("../parity/pr2.snapshot.json")).default;

const WEI = 10n ** 18n;
const PR2 = { pr: snap.pr, files: snap.files, prStatus: 200, filesStatus: 200 };
const OPEN_B1 = () => bounty({ created_at: "2026-11-06T07:22:17Z", deadline: new Date(Date.now() + 3 * H).toISOString(), judge_deadline: new Date(Date.now() + 6 * H).toISOString() });
const PAID_B1 = () => bounty({ status: "PAID", created_at: "2026-11-06T07:22:17Z", deadline: "2026-11-06T10:22:16Z", judge_deadline: "2026-11-06T13:22:16Z", winner_claim: 2, claim_count: 2 });

function setup({ detail, claims = [], wallet = HUNTER, fetchPr = vi.fn(async () => PR2) } = {}) {
  const writeTx = vi.fn(async ({ onUpdate }) => {
    onUpdate({ phase: "finalized", hash: "0xabc", result: { returnValue: "3" } });
    return { hash: "0xabc", result: { returnValue: "3" } };
  });
  const props = {
    contractAddress: "0xFb2372a7325F63Bb4f0a3330C075e9F58Fe7466A",
    readClient: {},
    connect: vi.fn(async () => ({ address: wallet, client: {} })),
    writeTx,
    readBounties: vi.fn(async () => []),
    readBounty: vi.fn(async () => detail),
    readClaims: vi.fn(async () => claims),
    getBalance: vi.fn(async () => 50n * WEI),
    fundTestGen: vi.fn(),
    fetchPr,
    pollMs: 1e9,
  };
  render(<App {...props} />);
  return props;
}

const connect = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
  await screen.findByText("50 GEN");
};

beforeEach(() => { window.location.hash = "#/bounty/1"; clearPullRequestCache(); });

describe("claim preflight", () => {
  it("shows a passing checklist for the hunter before signing", async () => {
    const p = setup({ detail: OPEN_B1() });
    await connect();
    await userEvent.type(screen.getByLabelText("Pull request"), "2");
    const form = screen.getByRole("form", { name: "Submit a claim" });
    const list = await within(form).findByLabelText("Preflight checklist");
    expect(list).toHaveTextContent("All hard checks pass");
    expect(within(list).getAllByText("ok")).toHaveLength(5);
    expect(p.fetchPr).toHaveBeenCalledWith("gosof32/genlayer-bounty-payout", 2, expect.anything());
    await userEvent.click(within(form).getByRole("button", { name: "Submit claim" }));
    await waitFor(() => expect(p.writeTx).toHaveBeenCalled());
    expect(p.writeTx.mock.calls[0][0]).toMatchObject({ functionName: "submit_claim", args: [1, "2"] });
  });

  it("warns that the outsider's claim would be rejected with MISSING_AUTHORSHIP but still allows signing", async () => {
    const p = setup({ detail: OPEN_B1(), wallet: OUTSIDER });
    await connect();
    await userEvent.type(screen.getByLabelText("Pull request"), "https://github.com/gosof32/genlayer-bounty-payout/pull/2");
    const form = screen.getByRole("form", { name: "Submit a claim" });
    const list = await within(form).findByLabelText("Preflight checklist");
    expect(list).toHaveTextContent("This claim would be rejected with MISSING_AUTHORSHIP.");
    expect(list).toHaveTextContent("The PR body does not contain the hunter's wallet address.");
    expect(within(list).getByText("MISSING_AUTHORSHIP", { selector: ".pf-code" })).toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Submit anyway (would be rejected)" }));
    await waitFor(() => expect(p.writeTx).toHaveBeenCalled());
  });

  it("handles GitHub's rate limit without blocking the claim", async () => {
    const fetchPr = vi.fn(async () => { throw new RateLimitError(new Date(Date.now() + 600000)); });
    const p = setup({ detail: OPEN_B1(), fetchPr });
    await connect();
    await userEvent.type(screen.getByLabelText("Pull request"), "2");
    const form = screen.getByRole("form", { name: "Submit a claim" });
    expect(await within(form).findByText(/rate limit/)).toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Submit claim" }));
    await waitFor(() => expect(p.writeTx).toHaveBeenCalled());
  });

  it("says an open PR would be NOT_READY", async () => {
    setup({ detail: OPEN_B1(), fetchPr: vi.fn(async () => ({ ...PR2, pr: { ...snap.pr, state: "open", merged: false, merged_at: null } })) });
    await connect();
    await userEvent.type(screen.getByLabelText("Pull request"), "2");
    expect(await screen.findByText(/would return NOT_READY/)).toBeInTheDocument();
  });
});

describe("Check a PR (read-only, no wallet)", () => {
  it("checks real PR #2 against bounty #1 for each claimant, matching the on-chain history", async () => {
    const claims = [
      claim({ id: 1, hunter: OUTSIDER, status: "SUPERSEDED", attempts: 1, codes: ["MISSING_AUTHORSHIP"] }),
      claim({ id: 2, hunter: HUNTER, status: "ACCEPTED", attempts: 1 }),
    ];
    setup({ detail: PAID_B1(), claims });
    const tool = await screen.findByRole("region", { name: "Check a PR" });
    expect(screen.queryByRole("form", { name: "Submit a claim" })).not.toBeInTheDocument();
    await userEvent.type(within(tool).getByLabelText("PR to check"), "2");
    await userEvent.click(within(tool).getByRole("button", { name: /Claim #1 hunter/ }));
    expect(await within(tool).findByText("This claim would be rejected with MISSING_AUTHORSHIP.")).toBeInTheDocument();
    expect(within(tool).getByText(/Addresses in this PR body/)).toBeInTheDocument();
    await userEvent.click(within(tool).getByRole("button", { name: /Claim #2 hunter/ }));
    expect(await within(tool).findByText(/All hard checks pass/)).toBeInTheDocument();
  });

  it("explains a PR number GitHub doesn't know", async () => {
    setup({ detail: PAID_B1(), fetchPr: vi.fn(async () => ({ pr: null, files: null, prStatus: 404, filesStatus: null })) });
    const tool = await screen.findByRole("region", { name: "Check a PR" });
    await userEvent.type(within(tool).getByLabelText("PR to check"), "1");
    expect(await within(tool).findByText(/GitHub has no pull request #1/)).toHaveTextContent("INCONCLUSIVE");
  });

  it("shows the contract's own error for a PR outside the bounty repo", async () => {
    const fetchPr = vi.fn();
    setup({ detail: PAID_B1(), fetchPr });
    const tool = await screen.findByRole("region", { name: "Check a PR" });
    await userEvent.type(within(tool).getByLabelText("PR to check"), "https://github.com/other/repo/pull/2");
    expect(within(tool).getByRole("alert")).toHaveTextContent("[INVALID] pull request is not in the bounty repository");
    expect(fetchPr).not.toHaveBeenCalled();
  });
});

describe("Embed badge", () => {
  it("offers Markdown and HTML snippets linking to the bounty page, with a preview", async () => {
    setup({ detail: PAID_B1() });
    const panel = await screen.findByRole("region", { name: "Embed badge" });
    expect(within(panel).getByLabelText("Markdown snippet")).toHaveTextContent(
      "[![Bounty #1](https://bounty-payout-dapp.vercel.app/api/badge?id=1)](https://bounty-payout-dapp.vercel.app/#/bounty/1)");
    expect(within(panel).getByLabelText("HTML snippet")).toHaveTextContent('<a href="https://bounty-payout-dapp.vercel.app/#/bounty/1">');
    expect(within(panel).getByRole("button", { name: "Copy Markdown" })).toBeInTheDocument();
    const img = within(panel).getByAltText("Bounty #1 badge preview");
    expect(decodeURIComponent(img.getAttribute("src"))).toContain("PAID 100,000,000 wei");
  });
});
