import { describe, it, expect } from "vitest";
import { describeReceipt, assertFinalizedSuccess } from "../../src/lib/tx.js";

const receipt = (over = {}, leader = { execution_result: "SUCCESS", result: { status: "return", payload: { readable: "1" } } }) => ({
  statusName: "FINALIZED",
  resultName: "MAJORITY_AGREE",
  consensus_data: { leader_receipt: [leader] },
  ...over,
});

describe("receipts", () => {
  it("accepts a finalized, agreed, successful transaction and exposes the return value", () => {
    const d = describeReceipt(receipt());
    expect(d.ok).toBe(true);
    expect(d.returnValue).toBe("1");
  });

  it("rejects a transaction that is not finalized", () => {
    expect(describeReceipt(receipt({ statusName: "ACCEPTED" })).error).toMatch(/not finalized/);
  });

  it("rejects failed consensus", () => {
    expect(describeReceipt(receipt({ resultName: "DISAGREE" })).error).toMatch(/Consensus failed/);
  });

  it("surfaces the contract's revert reason", () => {
    const r = receipt({}, { execution_result: "ERROR", result: { status: "user_error", payload: { readable: "[LOCKED] a claim is still pending" } } });
    expect(() => assertFinalizedSuccess(r)).toThrow(/\[LOCKED\]/);
  });

  it("handles a missing receipt", () => {
    expect(describeReceipt(null).ok).toBe(false);
  });
});
