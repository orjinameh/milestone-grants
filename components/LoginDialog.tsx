"use client";
import { useState } from "react";
import type { Config } from "../lib/chain";
import { loginExtension, loginFiles, type Wallet } from "../lib/wallet";

type Tab = "extension" | "keystore";
const readFile = (f: File) => f.text();

export default function LoginDialog({ cfg, onWallet, onClose }: { cfg: Config; onWallet: (w: Wallet) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("extension");
  const [accounts, setAccounts] = useState<Wallet[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const guard = async (fn: () => Promise<void>) => { setErr(""); setBusy(true); try { await fn(); } catch (e) { setErr((e as Error).message); } setBusy(false); };

  return (
    <div className="dlg-back" role="dialog" aria-modal="true" aria-labelledby="dlg-h" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h2 id="dlg-h">Log in to Portaldot</h2>
        <div className="row">
          <button className={tab === "extension" ? "btn" : "btn btn-quiet"} onClick={() => setTab("extension")}>Browser extension</button>
          <button className={tab === "keystore" ? "btn" : "btn btn-quiet"} onClick={() => setTab("keystore")}>Keystore JSON</button>
        </div>
        {tab === "extension" ? (
          <>
            <p>Desktop browsers only, or a mobile browser with extension support such as Orion.</p>
            {accounts.length === 0
              ? <button className="btn" disabled={busy} onClick={() => guard(async () => { const a = await loginExtension(cfg); if (a.length === 1) onWallet(a[0]); else setAccounts(a); })}>Connect extension</button>
              : <ul>{accounts.map((a) => <li key={a.ss58}><button className="btn btn-quiet mono" onClick={() => onWallet(a)}>{a.name} · {a.ss58.slice(0, 8)}…{a.ss58.slice(-6)}</button></li>)}</ul>}
          </>
        ) : (
          <>
            <label>JSON file(s): keystore, account info, or both<input type="file" multiple accept=".json,application/json" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></label>
            <label>Keystore password (not needed for an account info file alone)<input type="password" value={password} autoComplete="off" onChange={(e) => setPassword(e.target.value)} /></label>
            <p>The key is decrypted in this browser tab and never leaves it.</p>
            <button className="btn" disabled={busy || files.length === 0}
              onClick={() => guard(async () => onWallet(await loginFiles(cfg, await Promise.all(files.map(async (f) => ({ name: f.name, text: await readFile(f) }))), password)))}>Log in</button>
          </>
        )}
        {err && <p className="field-err" role="alert">{err}</p>}
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
