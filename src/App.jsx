import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONTRACT_ADDRESS, EXPLORER_BASE } from "./config.js";
import {
  connectWallet as defaultConnect, createReadClient, fundTestGen as defaultFund, getBalance as defaultBalance,
  writeAndFinalize as defaultWrite,
} from "./lib/wallet.js";
import {
  formatGen, parseRoute, readBounties as defaultReadBounties, readBounty as defaultReadBounty, readClaims as defaultReadClaims,
} from "./lib/bounty.js";
import BountyList from "./components/BountyList.jsx";
import BountyDetail from "./components/BountyDetail.jsx";
import CreateBounty from "./components/CreateBounty.jsx";
import TxLog, { short } from "./components/TxLog.jsx";

const TABS = [
  ["list", "Bounties", "#/"],
  ["create", "Post a bounty", "#/create"],
  ["how", "How it works", "#/how"],
];

const currentHash = () => (typeof window !== "undefined" ? window.location.hash : "");

export default function App({
  contractAddress = CONTRACT_ADDRESS,
  connect = defaultConnect,
  writeTx = defaultWrite,
  readBounties = defaultReadBounties,
  readBounty = defaultReadBounty,
  readClaims = defaultReadClaims,
  fundTestGen = defaultFund,
  getBalance = defaultBalance,
  readClient: injectedReadClient,
  pollMs = 20000,
}) {
  const readClient = useMemo(() => injectedReadClient ?? createReadClient(), [injectedReadClient]);
  const [route, setRoute] = useState(() => parseRoute(currentHash()));
  const [wallet, setWallet] = useState(null);
  const [balance, setBalance] = useState(null);
  const [walletError, setWalletError] = useState("");
  const [bounties, setBounties] = useState(null);
  const [detail, setDetail] = useState(null); // { bounty, claims }
  const [loadError, setLoadError] = useState("");
  const [txs, setTxs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const txId = useRef(0);

  useEffect(() => {
    const onHash = () => { setRoute(parseRoute(currentHash())); window.scrollTo?.(0, 0); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (hash) => {
    if (typeof window !== "undefined") window.location.hash = hash;
    setRoute(parseRoute(hash));
  };

  const refresh = useCallback(async () => {
    try {
      if (route.name === "bounty") {
        const [bounty, claims] = await Promise.all([
          readBounty(readClient, contractAddress, route.id),
          readClaims(readClient, contractAddress, route.id),
        ]);
        setDetail({ id: route.id, bounty, claims });
      } else {
        setBounties(await readBounties(readClient, contractAddress));
      }
      setLoadError("");
    } catch (e) {
      const msg = e?.shortMessage ?? e?.message ?? String(e);
      setLoadError(/NOT_FOUND|unknown bounty/i.test(msg) ? `Bounty #${route.id} does not exist on this contract.` : `Could not read the contract: ${msg}`);
    }
    if (wallet) setBalance(await getBalance(readClient, wallet.address).catch(() => null));
  }, [readClient, contractAddress, route.name, route.id, wallet, readBounties, readBounty, readClaims, getBalance]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); refresh(); }, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  const handleConnect = async () => {
    setWalletError("");
    try {
      setWallet(await connect());
    } catch (e) {
      setWallet(null);
      setWalletError(e?.message ?? String(e));
    }
  };

  const patchTx = (id, patch) => setTxs((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  // Sends a write and tracks it to FINALIZED. Returns the finalized result, or null.
  const run = async (label, functionName, args, value = 0n, { summarize } = {}) => {
    const id = ++txId.current;
    if (!wallet) {
      setTxs((all) => [{ id, label, phase: "error", message: "Connect your wallet to sign this transaction. Reading works without one." }, ...all]);
      return null;
    }
    setTxs((all) => [{ id, label, phase: "signing" }, ...all]);
    setBusy(true);
    let last = "signing";
    try {
      const out = await writeTx({
        walletClient: wallet.client,
        readClient,
        address: contractAddress,
        functionName,
        args,
        value,
        onUpdate: (u) => {
          last = u.phase;
          const patch = { ...u };
          if (u.phase === "finalized" && summarize) patch.summary = summarize(u.result?.returnValue);
          patchTx(id, patch);
        },
      });
      await refresh();
      return out ?? {};
    } catch (e) {
      patchTx(id, { phase: "error", lastPhase: last, message: e?.shortMessage ?? e?.message ?? String(e) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const getGen = async () => {
    const id = ++txId.current;
    setTxs((all) => [{ id, label: "Get 100 test GEN (Studionet)", phase: "submitted" }, ...all]);
    try {
      await fundTestGen(readClient, wallet.address, 100);
      patchTx(id, { phase: "finalized" });
      setBalance(await getBalance(readClient, wallet.address).catch(() => null));
    } catch (e) {
      patchTx(id, { phase: "error", lastPhase: "submitted", message: e?.message ?? String(e) });
    }
  };

  const onCreate = async (args, value) => {
    const out = await run(`Create bounty on ${args[0]}#${args[1]}`, "create_bounty", args, value);
    if (!out) return;
    const newId = Number(out.result?.returnValue);
    go(Number.isInteger(newId) && newId > 0 ? `#/bounty/${newId}` : "#/");
  };

  const shownDetail = detail && route.name === "bounty" && detail.id === route.id ? detail : null;
  const tabKey = route.name === "bounty" ? "list" : route.name;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>◆</span>
          <div>
            <h1><a href="#/" className="home">Bounty Payout</a></h1>
            <p className="muted small">
              GitHub bounties judged by GenLayer validators · contract{" "}
              <a href={`${EXPLORER_BASE}/address/${contractAddress}`} target="_blank" rel="noreferrer">
                {short(contractAddress)}
              </a>{" "}on Studionet
            </p>
          </div>
        </div>
        <div className="wallet">
          {wallet ? (
            <>
              <span className="pill" title={wallet.address}>{short(wallet.address)}</span>
              {balance !== null && <span className="pill">{formatGen(balance, 2)} GEN</span>}
              <button onClick={getGen}>Get test GEN</button>
            </>
          ) : (
            <button className="primary" onClick={handleConnect}>Connect wallet</button>
          )}
        </div>
      </header>
      {walletError && <p className="error" role="alert">{walletError}</p>}

      {route.name === "list" && (
        <section className="hero">
          <h2>Bounties that pay themselves when the PR is merged.</h2>
          <p>
            A sponsor escrows GEN against a GitHub issue and plain-text acceptance criteria. A hunter claims it with a pull
            request. GenLayer validators each read the PR from GitHub, check the hard facts in code and grade every criterion;
            if they agree it passes, the reward is paid in the same transaction. Nobody can veto an accepted claim.
          </p>
        </section>
      )}

      <nav className="tabs" aria-label="Sections">
        {TABS.map(([k, label, href]) => (
          <a key={k} href={href} className={tabKey === k ? "on" : ""} aria-current={tabKey === k ? "page" : undefined}>{label}</a>
        ))}
      </nav>

      <main className="layout">
        <div className="main-col">
          {loadError && (
            <div className="error card" role="alert">
              {loadError} <button onClick={refresh}>Retry</button>
            </div>
          )}
          {route.name === "list" && (
            <>
              {bounties === null && !loadError && <p className="muted">Loading bounties from the contract…</p>}
              {bounties?.length === 0 && <p className="muted">No bounties yet. <a href="#/create">Post the first one.</a></p>}
              {bounties && bounties.length > 0 && <BountyList bounties={bounties} now={now} />}
            </>
          )}
          {route.name === "bounty" && (
            <>
              {!shownDetail && !loadError && <p className="muted">Loading bounty #{route.id}…</p>}
              {shownDetail && (
                <BountyDetail
                  bounty={shownDetail.bounty}
                  claims={shownDetail.claims}
                  wallet={wallet?.address}
                  busy={busy}
                  now={now}
                  onAction={run}
                  onConnect={handleConnect}
                />
              )}
            </>
          )}
          {route.name === "create" && <CreateBounty wallet={wallet?.address} busy={busy} onCreate={onCreate} onConnect={handleConnect} />}
          {route.name === "how" && <HowItWorks />}
        </div>
        <aside className="side-col">
          <TxLog txs={txs} />
          {!wallet && (
            <section className="card">
              <h3>Try it</h3>
              <ol className="small">
                <li>Browse bounties: no wallet needed.</li>
                <li>Connect a wallet. The app adds GenLayer Studionet for you, then tap "Get test GEN".</li>
                <li>Post a bounty on a public repo you control, open a PR with your address in the body, merge it, then claim and judge.</li>
              </ol>
            </section>
          )}
        </aside>
      </main>
      <footer className="muted small">
        Open source · contract, tests and this app on{" "}
        <a href="https://github.com/gosof32/bounty-payout-dapp" target="_blank" rel="noreferrer">GitHub</a> · Studionet test GEN has no value
      </footer>
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="card how">
      <h3>How a bounty pays out</h3>
      <ol>
        <li><b>Post.</b> The sponsor names a public repo and issue, writes 1-8 acceptance criteria, sets a deadline and escrows the reward.</li>
        <li><b>Build.</b> The hunter opens a PR that references the issue (<code>Closes #7</code>) and puts their wallet address in the PR body. That address is the proof of authorship.</li>
        <li><b>Claim.</b> The hunter submits the PR number from that wallet before the deadline. One claim per wallet per bounty.</li>
        <li><b>Judge.</b> Anyone can judge a pending claim. Validators read the PR from the GitHub API; contract code checks it is merged into the right repo inside the window, links the issue and carries the hunter's address. Only then does an LLM grade each criterion pass/fail with a reason.</li>
        <li><b>Agree.</b> Each validator repeats the read and grading. They must match every hard fact exactly and every criterion's pass/fail, or the vote fails.</li>
        <li><b>Settle.</b> All checks pass → PAID to the hunter in the same transaction, other claims SUPERSEDED. Rejected → the hunter can update the PR and re-judge (limited attempts).</li>
      </ol>
      <h3>When can the sponsor get the reward back?</h3>
      <ul>
        <li><b>Cancel</b>: sponsor only, while the bounty is open and no claim can still be judged.</li>
        <li><b>Refund</b>: anyone, after the deadline when no claim is live, or after the judging window regardless. The reward always goes back to the sponsor.</li>
      </ul>
      <h3>Judge outcomes that change nothing</h3>
      <p><code>NOT_READY</code> (PR still open) and <code>INCONCLUSIVE</code> (GitHub or the model unavailable) leave the claim pending and use no attempt. Just judge again later.</p>
    </section>
  );
}
