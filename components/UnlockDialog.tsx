"use client";
import { useState } from "react";

/** Asked only when signing after a page refresh: the keystore is restored still encrypted. */
export default function UnlockDialog({ attempt, onDone, onCancel }: { attempt: (password: string) => void; onDone: () => void; onCancel: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const submit = () => { if (!pw) return; try { attempt(pw); onDone(); } catch { setErr("Wrong password for this keystore."); } };
  return (
    <div className="dlg-back" role="dialog" aria-modal="true" aria-labelledby="unlock-h" onClick={onCancel}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h2 id="unlock-h">Unlock to sign</h2>
        <p>Enter your keystore password to sign this transaction. It stays in this browser tab.</p>
        <label>Keystore password<input type="password" autoFocus autoComplete="off" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} /></label>
        {err && <p className="field-err" role="alert">{err}</p>}
        <button className="btn" disabled={!pw} onClick={submit}>Unlock</button>
        <button className="btn btn-quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
