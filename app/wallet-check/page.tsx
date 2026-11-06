"use client";

import { useState } from "react";

type Provider = {
  request: (args: { method: string }) => Promise<unknown>;
  isMetaMask?: boolean;
  isBitgetWallet?: boolean;
  isTrust?: boolean;
  isCoinbaseWallet?: boolean;
};

export default function WalletCheck() {
  const [result, setResult] = useState("Tap the button to check Safari.");
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    setResult("Checking…");

    try {
      const found = new Map<string, Provider>();
      const w = window as any;

      const add = (p: Provider, name: string) => {
        if (p && typeof p.request === "function") found.set(name, p);
      };

      if (w.ethereum?.providers?.length) {
        w.ethereum.providers.forEach((p: Provider, i: number) => add(p, `Injected provider ${i + 1}`));
      } else if (w.ethereum) {
        add(w.ethereum, "Injected provider");
      }

      const listener = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (detail?.provider) add(detail.provider, detail.info?.name || "EIP-6963 wallet");
      };

      window.addEventListener("eip6963:announceProvider", listener);
      window.dispatchEvent(new Event("eip6963:requestProvider"));
      await new Promise(resolve => setTimeout(resolve, 1200));
      window.removeEventListener("eip6963:announceProvider", listener);

      if (!found.size) {
        setResult(JSON.stringify({
          ethereumDetected: false,
          message: "Safari did not expose an injected EVM wallet provider."
        }, null, 2));
      } else {
        const providers = await Promise.all(
          [...found.entries()].map(async ([name, p]) => ({
            name,
            isMetaMask: !!p.isMetaMask,
            isBitget: !!p.isBitgetWallet,
            isTrust: !!p.isTrust,
            isCoinbase: !!p.isCoinbaseWallet,
            chainId: await p.request({ method: "eth_chainId" }).catch(() => "unavailable")
          }))
        );

        setResult(JSON.stringify({ ethereumDetected: true, providers }, null, 2));
      }
    } catch (e) {
      setResult((e as Error).message);
    }

    setBusy(false);
  }

  return (
    <main style={{ maxWidth: 600, margin: "60px auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1>Milestone Grants · Wallet Check</h1>
      <p>This checks browser wallet availability. It does not request account access or expose private keys.</p>
      <button onClick={check} disabled={busy} style={{ padding: 14, cursor: "pointer" }}>
        {busy ? "Checking…" : "Check Safari"}
      </button>
      <pre style={{ marginTop: 24, padding: 16, background: "#eee", color: "#111", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {result}
      </pre>
    </main>
  );
}
