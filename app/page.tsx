"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { calls } from "../lib/api";
import { fmt, isNative, makeEthCall, parseUnits, readGrant, readGrantCount, short, type Config, type GrantView } from "../lib/chain";
import { restoreSession, toEvm, type Session, type Unlocker, type Wallet } from "../lib/wallet";
import LoginDialog from "../components/LoginDialog";
import UnlockDialog from "../components/UnlockDialog";
import GrantTrack from "../components/GrantTrack";
import NewGrant, { type NewGrantParams } from "../components/NewGrant";
import { Mark } from "../components/Icons";
import type { Run } from "../components/MilestoneDetail";

type Toast = { text: string; tone: "ok" | "bad" | "info" } | null;
type ListState = { kind: "loading" | "unconfigured" | "empty" | "error" | "ready"; text?: string };
const ZERO = "0x" + "00".repeat(20);
const SESSION_KEY = "mg-session";

export default function Page() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const account = wallet?.evm ?? null;
  const [restoring, setRestoring] = useState(true);
  const [unlockReq, setUnlockReq] = useState<{ attempt: (pw: string) => void; done: () => void; cancel: () => void } | null>(null);
  const unlocker: Unlocker = useCallback((attempt) => new Promise<void>((resolve, reject) => {
    setUnlockReq({ attempt, done: () => { setUnlockReq(null); resolve(); }, cancel: () => { setUnlockReq(null); reject(new Error("Signing cancelled.")); } });
  }), []);
  const setLogin = (w: Wallet) => { setWallet(w); try { localStorage.setItem(SESSION_KEY, JSON.stringify(w.session)); localStorage.removeItem("ext-account"); } catch {} };
  const logout = () => { setWallet(null); try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem("ext-account"); } catch {} };
  const chainOk = !!wallet;
  const [grants, setGrants] = useState<GrantView[]>([]);
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);
  const [configErr, setConfigErr] = useState(false);
  const now = Math.floor(Date.now() / 1000);

  const say = useCallback((t: Toast) => { setToast(t); }, []);
  useEffect(() => { if (toast?.tone === "ok") { const h = setTimeout(() => setToast(null), 6000); return () => clearTimeout(h); } }, [toast]);

  useEffect(() => {
    fetch("/config.json", { cache: "no-store" }).then((r) => r.json()).then(setCfg).catch(() => { setConfigErr(true); setRestoring(false); });
  }, []);

  useEffect(() => {
    if (!cfg) return;
    let saved: Session | null = null;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) saved = JSON.parse(raw);
      else { const ext = localStorage.getItem("ext-account"); if (ext) saved = { kind: "extension", address: ext, name: "Account" }; } // sessions saved by older versions
    } catch {}
    if (!saved || !saved.address) { setRestoring(false); return; }
    void restoreSession(cfg, saved, unlocker).then((w) => { if (w) setWallet(w); setRestoring(false); });
  }, [cfg, unlocker]);

  const load = useCallback(async () => {
    if (!cfg) return;
    if (!cfg.registryAddress) { setGrants([]); return setList({ kind: "unconfigured" }); }
    try {
      const call = makeEthCall(cfg, undefined, false);
      const n = await readGrantCount(call);
      if (n === 0) { setGrants([]); return setList({ kind: "empty" }); }
      const ids: number[] = [];
      for (let id = n - 1; id >= Math.max(0, n - 20); id--) ids.push(id);
      setGrants(await Promise.all(ids.map((id) => readGrant(call, id, account))));
      setList({ kind: "ready" });
    } catch (e) {
      setGrants([]);
      setList({ kind: "error", text: (e as Error).message });
    }
  }, [cfg, account]);
  useEffect(() => { void load(); }, [load]);

  const run: Run = async (data, label) => {
    if (!cfg) return;
    say({ text: label.pending, tone: "info" });
    try { await wallet!.send(cfg.registryAddress, data); } catch (e) { say({ text: (e as Error).message, tone: "bad" }); throw e; }
    say({ text: label.done, tone: "ok" });
    await load();
  };

  const create = async (p: NewGrantParams) => {
    if (!cfg) return;
    setBusy(true);
    try {
      const amounts = p.amounts.map((a) => parseUnits(a, cfg.nativeDecimals));
      const total = amounts.reduce((s, a) => s + BigInt(a), 0n).toString();
      const token = p.token || ZERO;
      const native = isNative(token);
      const deadline = Math.floor(Date.now() / 1000) + p.days * 86400;
      if (!native) {
        say({ text: "Approve the token transfer (sign with your account)…", tone: "info" });
        await wallet!.send(token, calls.erc20Approve(cfg.registryAddress, total));
      }
      say({ text: "Sign the grant with your account…", tone: "info" });
      const recipient = await toEvm(p.recipient, cfg), reviewers = await Promise.all(p.reviewers.map((r) => toEvm(r, cfg)));
      await wallet!.send(cfg.registryAddress, calls.createGrant({ token, recipient, deadline, threshold: p.threshold, repo: p.repo, reviewers, amounts }), native ? total : "0");
      say({ text: "Grant funded.", tone: "ok" });
      await load();
    } catch (e) { say({ text: (e as Error).message, tone: "bad" }); }
    setBusy(false);
  };

  const blocker = !cfg ? "Loading…" : !cfg.registryAddress ? "The registry address is not set in public/config.json." : !wallet ? "Log in to fund a grant." : null;

  const totals = useMemo(() => {
    if (!cfg) return null;
    const native = grants.filter((g) => isNative(g.token));
    return { released: native.reduce((s, g) => s + g.released, 0n), count: grants.length };
  }, [grants, cfg]);

  return (
    <>
      <a className="skip" href="#grants">Skip to grants</a>
      <header className="bar">
        <div className="bar-in">
          <span className="brand"><Mark /> Milestone Grants</span>
          <nav className="bar-r" aria-label="Wallet">
            <a className="bar-link" href="#new">New grant</a>
            {wallet
              ? <><span className="wallet" title={`${wallet.ss58}\nEVM ${wallet.evm}`}><i className="dot ok" />{short(wallet.ss58)}</span><button className="btn btn-quiet" onClick={logout}>Log out</button></>
              : <button className="btn" onClick={() => setLoginOpen(true)} disabled={!cfg || restoring}>{restoring ? "Restoring…" : "Log in"}</button>}
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <h1>Funds release when the commit is real.</h1>
          <p className="lede">Fund a builder in milestones. Each one is claimed with a git commit, checked by reviewers you choose, and paid out on-chain as soon as enough of them approve.</p>
          <ol className="how" aria-label="How a milestone is paid">
            <li><span className="how-node" /><b>Builder anchors a commit</b><span>The commit hash is stored on-chain and checked against GitHub.</span></li>
            <li><span className="how-node" /><b>Reviewers approve</b><span>You set how many of them must agree.</span></li>
            <li><span className="how-node on" /><b>Funds are released</b><span>The contract pays the milestone automatically.</span></li>
          </ol>
        </section>

        <div className="cols">
          <section id="grants" aria-labelledby="grants-h">
            <div className="sec-head">
              <h2 id="grants-h">Grants</h2>
              {list.kind === "ready" && totals && <p>{totals.count} on-chain, {fmt(totals.released, cfg!.nativeDecimals)} {cfg!.nativeSymbol} released</p>}
            </div>
            {configErr && <p className="empty bad">The app could not load its configuration (public/config.json).</p>}
            {list.kind === "loading" && !configErr && <p className="empty">Reading grants from the chain…</p>}
            {list.kind === "unconfigured" && <p className="empty">No registry is connected yet. Deploy the contract and set <span className="mono">registryAddress</span> in <span className="mono">public/config.json</span>.</p>}
            {list.kind === "empty" && <p className="empty">No grants yet. Fund the first one with the form.</p>}
            {list.kind === "error" && <p className="empty bad">Could not read the chain: {list.text}. Check the RPC URL and the registry address in <span className="mono">public/config.json</span>.</p>}
            {cfg && grants.map((g) => <GrantTrack key={g.id} g={g} symbol={cfg.nativeSymbol} decimals={cfg.nativeDecimals} account={account} now={now} run={run} />)}
          </section>
          <aside>{cfg && <NewGrant cfg={cfg} blocker={blocker} busy={busy} onCreate={create} />}</aside>
        </div>
      </main>

      {loginOpen && cfg && <LoginDialog cfg={cfg} onClose={() => setLoginOpen(false)} onWallet={(w) => { setLogin(w); setLoginOpen(false); }} />}
      {unlockReq && <UnlockDialog attempt={unlockReq.attempt} onDone={unlockReq.done} onCancel={unlockReq.cancel} />}
      <div className="toast-zone" aria-live="polite">
        {toast && <p className={`toast toast-${toast.tone}`}>{toast.text}<button className="icon" aria-label="Dismiss" onClick={() => setToast(null)}>×</button></p>}
      </div>
    </>
  );
}
