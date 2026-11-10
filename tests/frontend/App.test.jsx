import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("genlayer-js", () => ({ createClient: () => ({}) }));
vi.mock("genlayer-js/chains", () => ({ studionet: { id: 61999, name: "studionet" } }));

const { default: App } = await import("../../src/App.jsx");
const { bounty, claim, SPONSOR, HUNTER, OUTSIDER, ACCEPTED, H } = await import("./fixtures.js");

const WEI = 10n ** 18n;

function setup({ bounties = [], detail = null, claims = [], wallet = HUNTER, ...extra } = {}) {
  const writeTx = vi.fn(async ({ onUpdate }) => {
    onUpdate({ phase: "signing" });
    onUpdate({ phase: "submitted", hash: "0xabc123abc123abc123" });
    onUpdate({ phase: "accepted", hash: "0xabc123abc123abc123" });
    const result = { returnValue: extra.returnValue ?? "4" };
    onUpdate({ phase: "finalized", hash: "0xabc123abc123abc123", result });
    return { hash: "0xabc123abc123abc123", result };
  });
  const props = {
    contractAddress: "0xFb2372a7325F63Bb4f0a3330C075e9F58Fe7466A",
    readClient: {},
    connect: vi.fn(async () => ({ address: wallet, client: { tag: "wallet" } })),
    writeTx,
    readBounties: vi.fn(async () => bounties),
    readBounty: vi.fn(async () => detail),
    readClaims: vi.fn(async () => claims),
    getBalance: vi.fn(async () => 50n * WEI),
    fundTestGen: vi.fn(async () => "0x1"),
    fetchPr: vi.fn(async () => ({ pr: null, files: null, prStatus: 404, filesStatus: null })),
    pollMs: 1e9,
    ...extra,
  };
  render(<App {...props} />);
  return props;
}

const connect = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
  await screen.findByText("50 GEN");
};

beforeEach(() => { window.location.hash = ""; });

describe("App", () => {
  it("lists bounties read-only, with status badges and filters", async () => {
    setup({
      bounties: [
        bounty({ id: 3, title: "Cancel demo", status: "CANCELLED" }),
        bounty({ id: 2, title: "Refund demo", status: "REFUNDED" }),
        bounty({ id: 1, title: "Add a CONTRIBUTING guide", status: "PAID" }),
      ],
    });
    expect(await screen.findByText("Add a CONTRIBUTING guide")).toBeInTheDocument();
    expect(screen.getByText("PAID")).toBeInTheDocument();
    expect(screen.getByText("CANCELLED")).toBeInTheDocument();
    expect(screen.getAllByText("100,000,000 wei")).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: /Refunded/ }));
    expect(screen.queryByText("Cancel demo")).not.toBeInTheDocument();
    expect(screen.getByText("Refund demo")).toBeInTheDocument();
  });

  it("shows a read error with a retry", async () => {
    const readBounties = vi.fn().mockRejectedValueOnce(new Error("fetch failed")).mockResolvedValue([bounty()]);
    setup({ readBounties });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not read the contract: fetch failed");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Add a CONTRIBUTING guide")).toBeInTheDocument();
  });

  it("renders a paid bounty: links, per-criterion verdicts, rejection codes, no actions", async () => {
    window.location.hash = "#/bounty/1";
    setup({
      detail: bounty({ status: "PAID", winner_claim: 2, claim_count: 2, closed_at: "2026-11-06T07:29:00Z" }),
      claims: [
        claim({ id: 1, hunter: OUTSIDER, status: "SUPERSEDED", attempts: 1, codes: ["MISSING_AUTHORSHIP"], judged_at: "2026-11-06T07:27:00Z" }),
        claim({ id: 2, ...ACCEPTED }),
      ],
    });
    expect(await screen.findByText("Winning PR #2 ↗")).toHaveAttribute("href", "https://github.com/gosof32/genlayer-bounty-payout/pull/2");
    expect(screen.getByText(/Issue gosof32\/genlayer-bounty-payout#1/)).toHaveAttribute("href", "https://github.com/gosof32/genlayer-bounty-payout/issues/1");
    const accepted = screen.getByLabelText("Claim 2");
    expect(within(accepted).getAllByText("✓ pass")).toHaveLength(3);
    expect(within(accepted).getByText("CONTRIBUTING.md is added at the repository root.")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Claim 1")).getByText("MISSING_AUTHORSHIP")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Judge/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancel bounty/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refund/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Submit a claim")).not.toBeInTheDocument();
  });

  it("refuses to sign without a wallet", async () => {
    window.location.hash = "#/bounty/1";
    const p = setup({ detail: bounty({ claim_count: 1, has_live_claim: true }), claims: [claim()] });
    await userEvent.click(await screen.findByRole("button", { name: "Judge with validators" }));
    expect(await screen.findByText(/Connect your wallet to sign/)).toBeInTheDocument();
    expect(p.writeTx).not.toHaveBeenCalled();
  });

  it("judges a pending claim and shows the tx lifecycle to FINALIZED with an explorer link", async () => {
    window.location.hash = "#/bounty/1";
    const p = setup({
      detail: bounty({ claim_count: 1, has_live_claim: true }),
      claims: [claim()],
      returnValue: '{"attempts_left":1"codes":["ISSUE_NOT_LINKED",]"criteria":[]"status":"REJECTED"}',
    });
    await connect();
    await userEvent.click(await screen.findByRole("button", { name: "Judge with validators" }));
    await waitFor(() => expect(p.writeTx).toHaveBeenCalled());
    expect(p.writeTx.mock.calls[0][0]).toMatchObject({ functionName: "judge", args: [2], walletClient: { tag: "wallet" } });
    const item = (await screen.findByText(/Judge claim #2/)).closest("li");
    expect(item).toHaveAttribute("data-phase", "finalized");
    expect(within(item).getByText(/REJECTED: ISSUE_NOT_LINKED/)).toBeInTheDocument();
    expect(within(item).getByRole("link")).toHaveAttribute("href", "https://explorer-studio.genlayer.com/tx/0xabc123abc123abc123");
  });

  it("offers cancel to the sponsor only when no claim is live", async () => {
    window.location.hash = "#/bounty/1";
    const p = setup({ detail: bounty(), claims: [], wallet: SPONSOR });
    await connect();
    await userEvent.click(await screen.findByRole("button", { name: /Cancel bounty/ }));
    await waitFor(() => expect(p.writeTx).toHaveBeenCalled());
    expect(p.writeTx.mock.calls[0][0]).toMatchObject({ functionName: "cancel_bounty", args: [1] });
  });

  it("offers refund to anyone after the deadline with no live claim", async () => {
    window.location.hash = "#/bounty/1";
    const now = Date.now();
    const p = setup({ detail: bounty({ deadline: new Date(now - H).toISOString(), judge_deadline: new Date(now + H).toISOString() }), claims: [], wallet: OUTSIDER });
    await connect();
    expect(screen.queryByRole("button", { name: /Cancel bounty/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Refund to sponsor" }));
    await waitFor(() => expect(p.writeTx).toHaveBeenCalled());
    expect(p.writeTx.mock.calls[0][0]).toMatchObject({ functionName: "refund", args: [1] });
  });

  it("submits a claim and shows the PR body helper with the wallet address and a copy button", async () => {
    window.location.hash = "#/bounty/1";
    const p = setup({ detail: bounty(), claims: [] });
    await connect();
    expect(await screen.findByLabelText("PR body snippet")).toHaveTextContent(`Bounty payout address: ${HUNTER}`);
    expect(screen.getByRole("button", { name: "Copy PR body lines" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Pull request"), "https://github.com/gosof32/genlayer-bounty-payout/pull/2");
    await userEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    await waitFor(() => expect(p.writeTx).toHaveBeenCalled());
    expect(p.writeTx.mock.calls[0][0]).toMatchObject({ functionName: "submit_claim", args: [1, "2"] });
  });

  it("validates the PR reference before sending", async () => {
    window.location.hash = "#/bounty/1";
    const p = setup({ detail: bounty(), claims: [] });
    await connect();
    await userEvent.type(await screen.findByLabelText("Pull request"), "https://github.com/someone/else/pull/2");
    await userEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not in gosof32\/genlayer-bounty-payout/);
    expect(p.writeTx).not.toHaveBeenCalled();
  });

  it("creates a bounty with the reward attached and opens it", async () => {
    window.location.hash = "#/create";
    const p = setup({ detail: bounty({ id: 4 }), claims: [] });
    await connect();
    await userEvent.type(screen.getByLabelText("Repository"), "https://github.com/acme/widgets/issues/7");
    expect(screen.getByLabelText("Issue number")).toHaveValue("7");
    await userEvent.type(screen.getByLabelText("Title"), "Add a dry-run flag");
    await userEvent.type(screen.getByLabelText("Acceptance criteria"), "Adds a --dry-run flag{enter}Includes a unit test");
    await userEvent.clear(screen.getByLabelText("Reward"));
    await userEvent.type(screen.getByLabelText("Reward"), "2.5");
    await userEvent.click(screen.getByRole("button", { name: /Create bounty/ }));
    await waitFor(() => expect(p.writeTx).toHaveBeenCalled());
    const call = p.writeTx.mock.calls[0][0];
    expect(call.functionName).toBe("create_bounty");
    expect(call.args.slice(0, 4)).toEqual(["acme/widgets", 7, "Add a dry-run flag", '["Adds a --dry-run flag","Includes a unit test"]']);
    expect(call.args.slice(5)).toEqual([72, 3, 2]);
    expect(call.value).toBe(25n * 10n ** 17n);
    await waitFor(() => expect(window.location.hash).toBe("#/bounty/4"));
  });

  it("shows a failed transaction with the contract's reason", async () => {
    window.location.hash = "#/bounty/1";
    const writeTx = vi.fn(async ({ onUpdate }) => {
      onUpdate({ phase: "signing" });
      onUpdate({ phase: "submitted", hash: "0xdead" });
      throw new Error("Contract execution failed (ERROR): [LOCKED] a claim is still pending");
    });
    setup({ detail: bounty(), claims: [], wallet: SPONSOR, writeTx });
    await connect();
    await userEvent.click(await screen.findByRole("button", { name: /Cancel bounty/ }));
    expect(await screen.findByText(/\[LOCKED\]/)).toBeInTheDocument();
  });

  it("reports an unknown bounty id", async () => {
    window.location.hash = "#/bounty/99";
    setup({ readBounty: vi.fn(async () => { throw new Error("[NOT_FOUND] unknown bounty"); }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Bounty #99 does not exist");
  });
});
