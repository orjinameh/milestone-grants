"use client";
import { useState } from "react";
import type { Config } from "../lib/chain";
import { classify, loginExtension, loginFiles, type Wallet } from "../lib/wallet";

type Tab = "extension" | "keystore";
type Entry = { name: string; text: string; kind?: "keystore" | "info"; error?: string };

export default function LoginDialog({ cfg, onWallet, onClose }: { cfg: Config; onWallet: (w: Wallet) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("extension");
  const [accounts, setAccounts] = useState<Wallet[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const guard = async (fn: () => Promise<void>) => { setErr(""); setBusy(true); try { await fn(); } catch (e) { setErr((e as Error).message); } setBusy(false); };

  const valid = entries.filter((e) => e.kind);
  const hasKeystore = valid.some((e) => e.kind === "keystore");

  // Files are sorted by content, not by name or pick order, and picks add up: choose one file, then the other, or both at once.
  const addFiles = async (list: File[]) => {
    const added: Entry[] = await Promise.all(list.map(async (f) => {
      const text = await f.text();
      try { return { name: f.name, text, kind: classify(text).kind }; } catch (e) { return { name: f.name, text, error: (e as Error).message }; }
    }));
    setErr("");
    setEntries((old) => {
      let next = old;
      for (const n of added) next = [...next.filter((o) => o.name !== n.name && !(n.kind && o.kind === n.kind)), n];
      return next;
    });
  };

  return (
    <div className="dlg-back" role="dialog" aria-modal="true" aria-labelledby="dlg-h" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h2 id="dlg-h">Log in to Portaldot</h2>
        <div className="row">
          <button className={tab === "extension" ? "btn" : "btn btn-quiet"} onClick={() => setTab("extension")}>Browser extension</button>
          <button className={tab === "keystore" ? "btn" : "btn btn-quiet"} onClick={() => setTab("keystore")}>Keystore / account info JSON</button>
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
            <label>Keystore JSON, account info JSON, or both (either one logs you in)<input type="file" multiple accept=".json,application/json" onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; void addFiles(l); }} /></label>
            {entries.length > 0 && (
              <ul aria-label="Selected files">
                {entries.map((e) => <li key={e.name}><span className="mono">{e.name}</span> {e.error ? <span className="field-err">{e.error}</span> : e.kind === "keystore" ? "keystore" : "account info"}</li>)}
              </ul>
            )}
            {hasKeystore && <label>Keystore password<input type="password" value={password} autoComplete="off" onChange={(e) => setPassword(e.target.value)} /></label>}
            {valid.length > 0 && !hasKeystore && <p>Account info alone is a view-only login. Add the keystore file (or use the extension) to sign transactions.</p>}
            <p>The key is decrypted in this browser tab and never leaves it. You stay logged in after a refresh; the password is only asked again when you sign.</p>
            <button className="btn" disabled={busy || valid.length === 0 || (hasKeystore && !password)}
              onClick={() => guard(async () => onWallet(await loginFiles(cfg, valid.map((e) => ({ name: e.name, text: e.text })), password)))}>Log in</button>
          </>
        )}
        {err && <p className="field-err" role="alert">{err}</p>}
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
