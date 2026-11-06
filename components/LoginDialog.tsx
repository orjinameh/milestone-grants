"use client";

import { useState } from "react";
import type { Config } from "../lib/chain";
import { loginMetaMask, type Wallet } from "../lib/wallet";

export default function LoginDialog({
  cfg,
  onWallet,
  onClose,
}: {
  cfg: Config;
  onWallet: (wallet: Wallet) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    setBusy(true);
    setError("");

    try {
      const wallet = await loginMetaMask(cfg);
      onWallet(wallet);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dlg-back" role="dialog" aria-modal="true" aria-labelledby="dlg-h" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h2 id="dlg-h">Connect your wallet</h2>
        <p>Connect your existing MetaMask account to Milestone Grants on Portaldot V3.</p>
        <button className="btn" disabled={busy} onClick={connect}>
          {busy ? "Connecting…" : "Connect MetaMask"}
        </button>
        {error && <p className="field-err" role="alert">{error}</p>}
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
