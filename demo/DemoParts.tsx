"use client";
import type { Wallet } from "../lib/wallet";
import { short } from "../lib/chain";
import { DEMO_ACCOUNTS, demoWallet, resetDemo } from "./contract";
import { DEMO_REPO } from "./repo";

export function DemoLogin({ onWallet, onClose }: { onWallet: (w: Wallet) => void; onClose: () => void }) {
  return (
    <div className="dlg-back" role="dialog" aria-modal="true" aria-labelledby="dlg-h" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h2 id="dlg-h">Log in (demo)</h2>
        <p>Pick who you are acting as. You can switch at any time from the bar at the top.</p>
        <ul>{DEMO_ACCOUNTS.map((a) => <li key={a.ss58}><button className="btn btn-quiet" onClick={() => onWallet(demoWallet(a))}>{a.role} · <span className="mono">{a.ss58.slice(0, 8)}…{a.ss58.slice(-6)}</span></button></li>)}</ul>
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export function DemoSwitch({ wallet, onPick }: { wallet: Wallet; onPick: (w: Wallet) => void }) {
  return (
    <select className="who" aria-label="Acting as" value={wallet.ss58} onChange={(e) => { const a = DEMO_ACCOUNTS.find((x) => x.ss58 === e.target.value); if (a) onPick(demoWallet(a)); }}>
      {DEMO_ACCOUNTS.map((a) => <option key={a.ss58} value={a.ss58}>{a.role} · {short(a.ss58)}</option>)}
    </select>
  );
}

export function DemoBanner({ onReset }: { onReset: () => void }) {
  return (
    <div className="demo-bar" role="note">
      <span><b>Demo mode.</b> A simulated Portaldot chain running in this tab. No node, wallet or POT is used, and nothing is sent anywhere. The GitHub commit check is live. <a href="/">Open the real app</a></span>
      <button className="btn btn-quiet" onClick={() => { resetDemo(DEMO_REPO); onReset(); }}>Reset demo</button>
    </div>
  );
}
