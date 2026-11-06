"use client";
// The real app: reads and writes the deployed registry on Portaldot. It contains no simulated data.
// The simulated chain is a separate route with its own code; the two share only the screen (components/GrantsApp.tsx).
import { useEffect, useMemo, useState } from "react";
import GrantsApp, { type Mode } from "../components/GrantsApp";
import LoginDialog from "../components/LoginDialog";
import { isActivated, makeCall, contractTarget, registryTarget, restoreSession } from "../lib/wallet";
import type { Config } from "../lib/chain";

const SESSION_KEY = "mg-session";
const LEGACY_KEY = "ext-account"; // written by early versions
const KINDS = ["extension", "keystore", "both", "info"];

function realMode(cfg: Config): Mode {
  return {
    cfg,
    sessionKey: SESSION_KEY,
    legacyKeys: [LEGACY_KEY],
    read: makeCall(cfg),
    registry: () => registryTarget(cfg),
    tokenTarget: contractTarget,
    canReceive: (ss58) => isActivated(cfg, ss58),
    restore: async (saved, unlock) => {
      let s = saved;
      if (!s) { try { const ext = localStorage.getItem(LEGACY_KEY); if (ext) s = { kind: "extension", address: ext, name: "Account" }; } catch {} }
      if (!s || !KINDS.includes(s.kind)) return null;
      return restoreSession(cfg, s, unlock);
    },
    Login: (p) => <LoginDialog cfg={cfg} {...p} />,
    notReady: cfg.registry ? undefined : {
      blocker: "The registry address is not set in public/config.json.",
      help: <>No registry is connected yet. Deploy the contract and set <span className="mono">registry</span> (its 5… address) in <span className="mono">public/config.json</span>.</>,
    },
  };
}

export default function Page() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { fetch("/config.json", { cache: "no-store" }).then((r) => r.json()).then(setCfg).catch(() => setErr(true)); }, []);
  const mode = useMemo(() => (cfg ? realMode(cfg) : null), [cfg]);
  if (mode) return <GrantsApp mode={mode} />;
  return <main><p className="empty">{err ? "The app could not load its configuration (public/config.json)." : "Loading…"}</p></main>;
}
