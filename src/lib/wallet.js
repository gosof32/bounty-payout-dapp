import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { assertFinalizedSuccess } from "./tx.js";
import { NETWORK } from "../config.js";

// Read-only client: no account, no key.
export function createReadClient() {
  return createClient({ chain: studionet });
}

export function getInjectedProvider() {
  return typeof window !== "undefined" ? window.ethereum ?? null : null;
}

// User-controlled signing: the wallet (MetaMask, Rabby, OKX...) holds the key and
// approves each transaction. The app never sees or stores a private key.
export async function connectWallet(provider = getInjectedProvider()) {
  if (!provider) throw new Error("No browser wallet found. Install MetaMask (or another EIP-1193 wallet) to sign transactions.");
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error("Wallet did not authorize any account.");
  const address = accounts[0];
  await ensureStudionet(provider);
  const client = createClient({ chain: studionet, account: address, provider });
  return { address, client };
}

// Adds/switches the wallet to GenLayer Studionet with standard EIP-3085/3326 calls only,
// so it works on any EIP-1193 wallet (no MetaMask-only snap calls).
export async function ensureStudionet(provider) {
  const chainId = `0x${studionet.id.toString(16)}`;
  const current = await provider.request({ method: "eth_chainId" });
  if (typeof current === "string" && current.toLowerCase() === chainId.toLowerCase()) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (err) {
    const code = err?.code ?? err?.data?.originalError?.code;
    if (code !== 4902 && !/unrecognized|not added|unknown chain/i.test(err?.message ?? "")) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId,
        chainName: studionet.name ?? NETWORK,
        rpcUrls: studionet.rpcUrls?.default?.http ?? [],
        nativeCurrency: studionet.nativeCurrency ?? { name: "GEN", symbol: "GEN", decimals: 18 },
        blockExplorerUrls: studionet.blockExplorers?.default?.url ? [studionet.blockExplorers.default.url] : undefined,
      }],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  }
}

// Studionet test GEN. Studionet's simulator exposes sim_fundAccount, so testers can
// try payable flows (posting a bounty) without a faucet. Testnet only.
export async function fundTestGen(readClient, address, wholeGen = 100) {
  // JSON number on purpose: the RPC rejects BigInt serialization.
  const amount = Number(BigInt(wholeGen) * 10n ** 18n);
  return readClient.request({ method: "sim_fundAccount", params: [address, amount] });
}

export async function getBalance(readClient, address) {
  const hex = await readClient.request({ method: "eth_getBalance", params: [address, "latest"] });
  return BigInt(hex ?? 0);
}

// Sends a write (optionally with GEN attached) and resolves only once the transaction
// is FINALIZED with consensus agreement and a successful execution. Anything else throws.
export async function writeAndFinalize({ walletClient, readClient, address, functionName, args, value = 0n, onUpdate }) {
  if (!walletClient) throw new Error("Connect your wallet first.");
  onUpdate?.({ phase: "signing" });
  const hash = await walletClient.writeContract({ address, functionName, args, value });
  onUpdate?.({ phase: "submitted", hash });
  const accepted = await readClient.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 200, interval: 3000 }).catch(() => null);
  if (accepted) onUpdate?.({ phase: "accepted", hash });
  const receipt = await readClient.waitForTransactionReceipt({ hash, status: "FINALIZED", retries: 300, interval: 3000 });
  const result = assertFinalizedSuccess(receipt);
  onUpdate?.({ phase: "finalized", hash, result });
  return { hash, result };
}
