"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { calls } from "../lib/api";
import { fmt, isNative, parseUnits, readGrant, readGrantCount, short, type Config, type ContractCall, type GrantView } from "../lib/chain";
import { revokeWalletAccess, toAccountId, type Session, type Unlocker, type Wallet } from "../lib/wallet";
import UnlockDialog from "./UnlockDialog";
import { buildBook, type Book } from "../lib/addressBook";
import GrantTrack from "./GrantTrack";
import NewGrant, { type ExampleGrant, type NewGrantParams } from "./NewGrant";
import { Mark } from "./Icons";
import type { Run } from "./MilestoneDetail";

/** Everything that differs between the app's modes. The screen itself knows nothing about any one of them. */
export interface Mode {
  cfg: Config;
  /** localStorage key for the saved login. Each mode has its own, so one mode's login can never become another's. */
  sessionKey: string;
  /** Read-only calls to the registry. */
  read: ContractCall;
  /** The account that signed calls to the registry are sent to. */
  registry(): Promise<string>;
  /** Resolves a token contract to its call target. Leave out to hide the pay-in-a-token option. */
  tokenTarget?: (address: string) => Promise<string>;
  /** Runs before the first read and before a login is restored. */
  init?(): void;
  /** Rebuilds a login after a refresh. `saved` is what was stored under sessionKey, if anything. */
  restore(saved: Session | null, unlock: Unlocker): Promise<Wallet | null>;
  /** Can this account receive payouts? true/false, or null when unknown. Leave out when payouts need no setup. */
  canReceive?: (ss58: string) => Promise<boolean | null>;
  /** Extra localStorage keys to clear on login and logout. */
  legacyKeys?: string[];
  Login: ComponentType<{ onWallet: (w: Wallet) => void; onClose: () => void }>;
  /** Replaces the wallet badge in the header (for example an account picker). */
  AccountSwitch?: ComponentType<{ wallet: Wallet; onPick: (w: Wallet) => void }>;
  /** A strip under the header. `onReset` re-reads the grants. */
  Banner?: ComponentType<{ onReset: () => void }>;
  /** Set when nothing can be read or sent yet (no registry configured). */
  notReady?: { blocker: string; help: ReactNode };
  /** Shows a "Fill with an example" button on the New grant form. */
  example?: ExampleGrant;
}

type Toast = { text: string; tone: "ok" | "bad" | "info" } | null;
type ListState = { kind: "loading" | "unconfigured" | "empty" | "error" | "ready"; text?: string };
const ZERO32 = "0x" + "00".repeat(32); // native POT

export default function GrantsApp({ mode }: { mode: Mode }) {
  const cfg = mode.cfg;
  const { Login, AccountSwitch, Banner } = mode;
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const account = wallet?.id ?? null; // AccountId32 hex, what the contract stores
  const [restoring, setRestoring] = useState(true);
  const [logoutRequested, setLogoutRequested] = useState(() => { try { return sessionStorage.getItem("mg-logout") === "1"; } catch { return false; } });
  const [book, setBook] = useState<Book>({});
  const [unlockReq, setUnlockReq] = useState<{ attempt: (pw: string) => void; done: () => void; cancel: () => void } | null>(null);
  const unlocker: Unlocker = useCallback((attempt) => new Promise<void>((resolve, reject) => {
    setUnlockReq({ attempt, done: () => { setUnlockReq(null); resolve(); }, cancel: () => { setUnlockReq(null); reject(new Error("Signing cancelled.")); } });
  }), []);
  const setLogin = (w: Wallet) => { setLogoutRequested(false); try { sessionStorage.removeItem("mg-logout"); localStorage.setItem(mode.sessionKey, JSON.stringify(w.session)); mode.legacyKeys?.forEach((k) => localStorage.removeItem(k)); } catch {} setWallet(w); };
  const [copied, setCopied] = useState(false);
  const copyAddress = async () => {
    if (!wallet) return;
    try { await navigator.clipboard.writeText(wallet.ss58); }
    catch { // clipboard API unavailable (non-secure context, older mobile browsers)
      const t = document.createElement("textarea"); t.value = wallet.ss58; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch {} document.body.removeChild(t);
    }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };
  const logout = () => { void revokeWalletAccess(); setLogoutRequested(true); setWallet(null); setLoginOpen(false); try { sessionStorage.setItem("mg-logout", "1"); localStorage.removeItem(mode.sessionKey); mode.legacyKeys?.forEach((k) => localStorage.removeItem(k)); } catch {} };
  const chainOk = !!wallet;
  const [activated, setActivated] = useState<boolean | null>(null);
  const [grants, setGrants] = useState<GrantView[]>([]);
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);
  const now = Math.floor(Date.now() / 1000);

  const say = useCallback((t: Toast) => { setToast(t); }, []);
  useEffect(() => { if (toast?.tone === "ok") { const h = setTimeout(() => setToast(null), 6000); return () => clearTimeout(h); } }, [toast]);

  useEffect(() => {
    mode.init?.();
    if (logoutRequested) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    let saved: Session | null = null;
    try { const raw = localStorage.getItem(mode.sessionKey); if (raw) saved = JSON.parse(raw); } catch {}
    if (saved && !saved.address) saved = null;
    void mode.restore(saved, unlocker).then((w) => {
      if (cancelled) return;
      if (w) setWallet(w);
      setRestoring(false);
    }).catch(() => {
      if (!cancelled) setRestoring(false);
    });
    return () => { cancelled = true; };
  }, [mode, unlocker, logoutRequested]);

  const load = useCallback(async () => {
    if (mode.notReady) { setGrants([]); return setList({ kind: "unconfigured" }); }
    try {
      mode.init?.();
      const call = mode.read;
      const n = await readGrantCount(call);
      if (n === 0) { setGrants([]); return setList({ kind: "empty" }); }
      const ids: number[] = [];
      for (let id = n - 1; id >= Math.max(0, n - 20); id--) ids.push(id);
      const list = await Promise.all(ids.map((id) => readGrant(call, id, account)));
      setBook(await buildBook(list.flatMap((g) => [g.funder, g.recipient, ...g.reviewers]), cfg.ss58Format ?? 42, wallet ? { id: wallet.id, ss58: wallet.ss58 } : undefined));
      setGrants(list);
      setList({ kind: "ready" });
    } catch (e) {
      setGrants([]);
      setList({ kind: "error", text: (e as Error).message });
    }
  }, [mode, cfg, account, wallet]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setActivated(null);
    if (wallet && mode.canReceive) void mode.canReceive(wallet.ss58).then(setActivated);
  }, [wallet, mode]);
  const activate = async () => {
    if (!wallet?.activate) return;
    say({ text: "Activating your account (sign with your wallet)…", tone: "info" });
    try { await wallet.activate(); setActivated(await mode.canReceive!(wallet.ss58)); say({ text: "Account activated. You can now receive payouts.", tone: "ok" }); }
    catch (e) { say({ text: (e as Error).message, tone: "bad" }); }
  };

  const run: Run = async (data, label) => {
    say({ text: label.pending, tone: "info" });
    try { await wallet!.send(await mode.registry(), data); } catch (e) { say({ text: (e as Error).message, tone: "bad" }); throw e; }
    say({ text: label.done, tone: "ok" });
    await load();
  };

  const create = async (p: NewGrantParams) => {
    setBusy(true);
    try {
      const funderAddress = wallet!.ss58.toLowerCase();
      const recipientAddress = p.recipient.trim().toLowerCase();
      if (recipientAddress === funderAddress) throw new Error("You cannot create a grant for your own wallet.");
      if (p.reviewers.some((r) => r.trim().toLowerCase() === funderAddress)) throw new Error("You cannot be a reviewer on your own grant.");
      if (p.reviewers.some((r) => r.trim().toLowerCase() === recipientAddress)) throw new Error("The recipient cannot review their own grant.");
      if (new Set(p.reviewers.map((r) => r.trim().toLowerCase())).size !== p.reviewers.length) throw new Error("Two of the reviewers are the same account.");
      const amounts = p.amounts.map((a) => parseUnits(a, cfg.nativeDecimals));
      const total = amounts.reduce((s, a) => s + BigInt(a), 0n).toString();
      // Everything is a Substrate account: 5… addresses become the 32-byte ids the contract stores.
      if (mode.canReceive) { // payouts only reach an account that has activated itself; check before any money is locked
        for (const [who, addr] of [["Your account", wallet!.ss58], ["The recipient's account", p.recipient.trim()]] as const) {
          if (await mode.canReceive(addr) === false) throw new Error(who === "Your account"
            ? "Activate your account first (button in the top bar). Without it, a refund could not reach you."
            : "The recipient has to log in once and press Activate account first. Without it, payouts would not reach them.");
        }
      }
      const funder = wallet!.id;
      const recipient = await toAccountId(p.recipient);
      const reviewers = await Promise.all(p.reviewers.map((r) => toAccountId(r)));
      if (new Set(reviewers).size !== reviewers.length) throw new Error("Two of the reviewers are the same account.");
      const token = p.token ? await toAccountId(p.token) : ZERO32;
      const native = isNative(token);
      const target = await mode.registry();
      if (!native && !mode.tokenTarget) throw new Error("Paying in a token is not available here.");
      const tokenTarget = native ? "" : await mode.tokenTarget!(p.token); // checked before anything is signed
      const deadline = Math.floor(Date.now() / 1000) + p.days * 86400;
      if (!native) {
        say({ text: "Approve the token transfer (sign with your account)…", tone: "info" });
        await wallet!.send(tokenTarget, calls.erc20Approve(target, total));
      }
      say({ text: "Sign the grant with your account…", tone: "info" });
      await wallet!.send(target, calls.createGrant({ funder, token, recipient, deadline, threshold: p.threshold, repo: p.repo, reviewers, amounts }), native ? total : "0");
      say({ text: "Grant funded.", tone: "ok" });
      await load();
    } catch (e) { say({ text: (e as Error).message, tone: "bad" }); }
    setBusy(false);
  };

  const blocker = mode.notReady?.blocker ?? (!wallet ? "Log in to fund a grant." : null);

  const totals = useMemo(() => {
    const native = grants.filter((g) => isNative(g.token));
    return { released: native.reduce((s, g) => s + g.released, 0n), count: grants.length };
  }, [grants]);

  return (
    <>
      <a className="skip" href="#grants">Skip to grants</a>
      <header className="bar">
        <div className="bar-in">
          <span className="brand"><Mark /> Milestone Grants</span>
          <nav className="bar-r" aria-label="Wallet">
            <a className="bar-link" href="#new">New grant</a>
            {wallet?.activate && activated === false && <button className="btn" onClick={activate} title="One-time setup so payouts can reach your account">Activate account</button>}
            {wallet
              ? <>{AccountSwitch
                  ? <AccountSwitch wallet={wallet} onPick={setLogin} />
                  : <span className="wallet" title={wallet.ss58}><i className="dot ok" />{short(wallet.ss58)}</span>}<button className="btn btn-quiet" onClick={copyAddress} aria-label="Copy wallet address">{copied ? "Copied" : "Copy"}</button><button className="btn btn-quiet" onClick={logout}>Log out</button></>
              : <button className="btn" onClick={() => setLoginOpen(true)} disabled={restoring}>{restoring ? "Restoring…" : "Log in"}</button>}
          </nav>
        </div>
      </header>

      {Banner && <Banner onReset={() => void load()} />}

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
              {list.kind === "ready" && totals && <p>{totals.count} on-chain, {fmt(totals.released, cfg.nativeDecimals)} {cfg.nativeSymbol} released</p>}
            </div>
            {list.kind === "loading" && <p className="empty">Reading grants from the chain…</p>}
            {list.kind === "unconfigured" && <p className="empty">{mode.notReady?.help}</p>}
            {list.kind === "empty" && <p className="empty">No grants yet. Fund the first one with the form.</p>}
            {list.kind === "error" && <p className="empty bad">Could not read the chain: {list.text}. Check <span className="mono">wsUrl</span> and <span className="mono">registry</span> in <span className="mono">public/config.json</span>.</p>}
            {grants.map((g) => <GrantTrack key={g.id} g={g} symbol={cfg.nativeSymbol} decimals={cfg.nativeDecimals} account={account} now={now} run={run} book={book} />)}
          </section>
          <aside><NewGrant cfg={cfg} blocker={blocker} busy={busy} onCreate={create} allowToken={!!mode.tokenTarget} funderAddress={wallet?.ss58 ?? null} example={mode.example} /></aside>
        </div>
      </main>

      {loginOpen && <Login onClose={() => setLoginOpen(false)} onWallet={(w) => { setLogin(w); setLoginOpen(false); }} />}
      {unlockReq && <UnlockDialog attempt={unlockReq.attempt} onDone={unlockReq.done} onCancel={unlockReq.cancel} />}
      <div className="toast-zone" aria-live="polite">
        {toast && <p className={`toast toast-${toast.tone}`}>{toast.text}<button className="icon" aria-label="Dismiss" onClick={() => setToast(null)}>×</button></p>}
      </div>
    </>
  );
}
