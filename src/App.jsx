import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONTRACT_ADDRESS, EXPLORER_BASE } from "./config.js";
import {
  connectWallet as defaultConnect, createReadClient, fundTestGen as defaultFund, getBalance as defaultBalance,
  writeAndFinalize as defaultWrite,
} from "./lib/wallet.js";
import {
  formatGen, formatReward, parseRoute, readBounties as defaultReadBounties, readBounty as defaultReadBounty, readClaims as defaultReadClaims,
} from "./lib/bounty.js";
import BountyList from "./components/BountyList.jsx";
import BountyDetail from "./components/BountyDetail.jsx";
import CreateBounty from "./components/CreateBounty.jsx";
import TxLog, { short } from "./components/TxLog.jsx";
import Icon from "./components/Icons.jsx";

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
  const isList = route.name === "list";
  const wide = isList || route.name === "bounty";

  return (
    <div className="app">
      <div className="bg-fx" aria-hidden="true" />
      <header className={`top${wallet ? " connected" : ""}`}>
        <a href="#/" className="brand" aria-label="Bounty Payout home">
          <span className="logo"><Icon name="logo" size={22} strokeWidth={2.1} /></span>
          <span className="brand-text">
            <span className="brand-name">Bounty Payout</span>
            <span className="brand-sub">on GenLayer</span>
          </span>
        </a>
        <nav className="tabs" aria-label="Sections">
          {TABS.map(([k, label, href]) => (
            <a key={k} href={href} className={tabKey === k ? "on" : ""} aria-current={tabKey === k ? "page" : undefined}>{label}</a>
          ))}
        </nav>
        <div className="wallet">
          {wallet ? (
            <>
              <span className="pill addr" title={wallet.address}><span className="live-dot" aria-hidden="true" />{short(wallet.address)}</span>
              {balance !== null && <span className="pill bal">{formatGen(balance, 2)} GEN</span>}
              <button className="btn ghost sm gen-btn" onClick={getGen} aria-label="Get test GEN" title="Get test GEN"><Icon name="bolt" size={15} /><span className="btn-text">Get test GEN</span></button>
            </>
          ) : (
            <button className="btn primary sm" onClick={handleConnect}><Icon name="wallet" size={16} />Connect wallet</button>
          )}
        </div>
      </header>
      {walletError && <p className="banner error" role="alert">{walletError}</p>}

      {isList && <Hero bounties={bounties} />}
      {isList && <StepsStrip />}

      <main className={wide ? "layout single" : "layout"}>
        <div className="main-col">
          {loadError && (
            <div className="error-card" role="alert">
              <span>{loadError}</span> <button className="btn ghost sm" onClick={refresh}>Retry</button>
            </div>
          )}
          {isList && (
            <section className="board" aria-labelledby="board-title">
              <div className="section-head">
                <div>
                  <p className="eyebrow">The board</p>
                  <h2 id="board-title" className="section-title">Wanted: merged pull requests</h2>
                </div>
                <a className="btn primary sm hide-mobile" href="#/create"><Icon name="plus" size={16} />Post a bounty</a>
              </div>
              {bounties === null && !loadError && (
                <>
                  <p className="muted small">Loading bounties from the contract…</p>
                  <div className="bounty-grid" aria-hidden="true">
                    {[0, 1, 2].map((i) => <div key={i} className="poster skeleton" />)}
                  </div>
                </>
              )}
              {bounties?.length === 0 && (
                <div className="empty">
                  <Icon name="flag" size={28} />
                  <p>No bounties yet. <a href="#/create">Post the first one.</a></p>
                </div>
              )}
              {bounties && bounties.length > 0 && <BountyList bounties={bounties} now={now} />}
            </section>
          )}
          {route.name === "bounty" && (
            <>
              {!shownDetail && !loadError && <p className="muted loading-line">Loading bounty #{route.id}…</p>}
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
          {isList && !wallet && <TryIt wide />}
        </div>
        {!wide && (
          <aside className="side-col">
            {!wallet && <TryIt />}
            <section className="panel contract-card">
              <p className="eyebrow">Contract</p>
              <a className="mono-link" href={`${EXPLORER_BASE}/address/${contractAddress}`} target="_blank" rel="noreferrer" title={contractAddress}>
                {short(contractAddress)} <Icon name="external" size={14} />
              </a>
              <p className="muted small">GenLayer Studionet · test GEN has no value</p>
            </section>
          </aside>
        )}
      </main>
      <TxLog txs={txs} />
      <footer className="foot">
        <div className="foot-brand"><Icon name="logo" size={18} /> Bounty Payout</div>
        <p className="muted small">
          Open source · contract, tests and this app on{" "}
          <a href="https://github.com/gosof32/bounty-payout-dapp" target="_blank" rel="noreferrer">GitHub</a> · contract{" "}
          <a className="mono" href={`${EXPLORER_BASE}/address/${contractAddress}`} target="_blank" rel="noreferrer">{short(contractAddress)}</a>{" "}
          on Studionet · test GEN has no value
        </p>
      </footer>
    </div>
  );
}

// Splits "1,234 GEN" into number and unit so the figure and unit can be styled apart.
const splitAmount = (text) => {
  const i = text.lastIndexOf(" ");
  return i < 0 ? [text, ""] : [text.slice(0, i), text.slice(i + 1)];
};

function Hero({ bounties }) {
  const stats = useMemo(() => {
    if (!bounties) return null;
    const sum = (pred) => bounties.filter(pred).reduce((acc, b) => acc + b.reward, 0n);
    return {
      total: bounties.length,
      open: bounties.filter((b) => b.status === "OPEN").length,
      paid: sum((b) => b.status === "PAID"),
      paidCount: bounties.filter((b) => b.status === "PAID").length,
      escrowed: sum((b) => b.status === "OPEN"),
      claims: bounties.reduce((acc, b) => acc + b.claim_count, 0),
    };
  }, [bounties]);
  const [paidNum, paidUnit] = stats ? splitAmount(formatReward(stats.paid)) : ["–", ""];

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow hero-eyebrow"><span className="live-dot" aria-hidden="true" /> Live on GenLayer Studionet</p>
          <h1 id="hero-title" className="hero-title">Bounties that <span className="accent-text">pay themselves</span>.</h1>
          <p className="hero-sub">
            Escrow GEN on a GitHub issue. When a merged PR meets your criteria, GenLayer validators agree and the hunter is paid in the same transaction.
          </p>
          <div className="hero-cta">
            <a className="btn primary lg" href="#/create"><Icon name="plus" size={18} />Post a bounty</a>
            <a className="btn ghost lg" href="#/how">How it works <Icon name="arrowRight" size={18} /></a>
          </div>
        </div>
        <HeroArt />
      </div>
      <dl className="stats" aria-label="Contract stats">
        <div className="stat">
          <dt><Icon name="flag" size={15} />Bounties posted</dt>
          <dd><span className="stat-num">{stats ? stats.total : "–"}</span></dd>
          <p className="stat-sub">{stats ? `${stats.open} open now` : "Reading the contract…"}</p>
        </div>
        <div className="stat">
          <dt><Icon name="coins" size={15} />Paid out</dt>
          <dd><span className="stat-num">{paidNum}</span> <span className="stat-unit">{paidUnit}</span></dd>
          <p className="stat-sub">{stats ? `${formatReward(stats.escrowed)} in escrow` : " "}</p>
        </div>
        <div className="stat">
          <dt><Icon name="scale" size={15} />Claims submitted</dt>
          <dd><span className="stat-num">{stats ? stats.claims : "–"}</span></dd>
          <p className="stat-sub">{stats ? `${stats.paidCount} won by validator vote` : " "}</p>
        </div>
      </dl>
    </section>
  );
}

// Decorative "wanted poster" for the hero. Purely visual, hidden from assistive tech.
function HeroArt() {
  return (
    <div className="hero-art" aria-hidden="true">
      <div className="wanted">
        <div className="wanted-top"><span>Wanted</span><span className="mono">#0042</span></div>
        <div className="wanted-pr"><Icon name="merge" size={34} strokeWidth={1.6} /></div>
        <p className="wanted-line">One merged pull request</p>
        <p className="wanted-sub mono">acme/widgets#7</p>
        <div className="wanted-rule" />
        <ul className="wanted-checks">
          <li><Icon name="check" size={13} strokeWidth={3} />Merged before deadline</li>
          <li><Icon name="check" size={13} strokeWidth={3} />Issue linked</li>
          <li><Icon name="check" size={13} strokeWidth={3} />3 / 3 criteria met</li>
        </ul>
        <div className="wanted-validators">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ "--i": i }}><Icon name="check" size={11} strokeWidth={3} /></span>)}
          <em>validators agree</em>
        </div>
        <div className="wanted-reward"><span>Reward</span><strong>250 GEN</strong></div>
      </div>
      <div className="wanted ghost-card" />
    </div>
  );
}

const STRIP = [
  ["doc", "Post", "Sponsor escrows GEN on an issue with plain-text acceptance criteria."],
  ["merge", "PR merged", "Hunter merges a PR that links the issue and carries their wallet address."],
  ["users", "Validators judge", "Each validator reads the PR from GitHub and grades every criterion."],
  ["coins", "Paid", "If they agree it passes, the reward goes to the hunter in that same tx."],
];

function StepsStrip() {
  return (
    <section className="strip" aria-labelledby="strip-title">
      <h2 id="strip-title" className="sr-only">How a bounty pays out</h2>
      <ol className="strip-steps">
        {STRIP.map(([icon, title, text], i) => (
          <li key={title} className="strip-step" style={{ "--i": i }}>
            <span className="strip-icon"><Icon name={icon} size={20} /></span>
            <span className="strip-num">0{i + 1}</span>
            <h3>{title}</h3>
            <p>{text}</p>
          </li>
        ))}
      </ol>
      <p className="strip-note">
        <Icon name="shield" size={16} />
        Validators must reach consensus on every hard fact and every criterion. No sponsor veto, no stuck funds.
        <a href="#/how">Full rules <Icon name="arrowRight" size={14} /></a>
      </p>
    </section>
  );
}

function TryIt({ wide = false }) {
  return (
    <section className={`panel try ${wide ? "wide" : ""}`} aria-label="Try it">
      <h3><Icon name="sparkle" size={18} />Try it</h3>
      <ol className="try-list">
        <li><span>1</span>Browse bounties: no wallet needed.</li>
        <li><span>2</span>Connect a wallet. The app adds GenLayer Studionet for you, then tap "Get test GEN".</li>
        <li><span>3</span>Post a bounty on a public repo you control, open a PR with your address in the body, merge it, then claim and judge.</li>
      </ol>
    </section>
  );
}

const HOW = [
  ["doc", "Post", <>The sponsor names a public repo and issue, writes 1-8 acceptance criteria, sets a deadline and escrows the reward.</>],
  ["pr", "Build", <>The hunter opens a PR that references the issue (<code>Closes #7</code>) and puts their wallet address in the PR body. That address is the proof of authorship.</>],
  ["flag", "Claim", <>The hunter submits the PR number from that wallet before the deadline. One claim per wallet per bounty.</>],
  ["scale", "Judge", <>Anyone can judge a pending claim. Validators read the PR from the GitHub API; contract code checks it is merged into the right repo inside the window, links the issue and carries the hunter's address. Only then does an LLM grade each criterion pass/fail with a reason.</>],
  ["users", "Agree", <>Each validator repeats the read and grading. They must match every hard fact exactly and every criterion's pass/fail, or the vote fails.</>],
  ["coins", "Settle", <>All checks pass → PAID to the hunter in the same transaction, other claims SUPERSEDED. Rejected → the hunter can update the PR and re-judge (limited attempts).</>],
];

function HowItWorks() {
  return (
    <section className="how" aria-labelledby="how-title">
      <p className="eyebrow">The rules</p>
      <h2 id="how-title" className="section-title">How a bounty pays out</h2>
      <ol className="how-steps">
        {HOW.map(([icon, title, body], i) => (
          <li key={title} className="how-step">
            <span className="how-icon"><Icon name={icon} size={20} /></span>
            <div>
              <h3><span className="how-num">{i + 1}</span>{title}</h3>
              <p>{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="how-grid">
        <div className="panel">
          <h3><Icon name="undo" size={18} />When can the sponsor get the reward back?</h3>
          <ul>
            <li><b>Cancel</b>: sponsor only, while the bounty is open and no claim can still be judged.</li>
            <li><b>Refund</b>: anyone, after the deadline when no claim is live, or after the judging window regardless. The reward always goes back to the sponsor.</li>
          </ul>
        </div>
        <div className="panel">
          <h3><Icon name="clock" size={18} />Judge outcomes that change nothing</h3>
          <p><code>NOT_READY</code> (PR still open) and <code>INCONCLUSIVE</code> (GitHub or the model unavailable) leave the claim pending and use no attempt. Just judge again later.</p>
        </div>
      </div>
    </section>
  );
}
