"use client";

import { useEffect, useMemo, useState } from "react";
import GrantsApp, { type Mode } from "../components/GrantsApp";
import LoginDialog from "../components/LoginDialog";
import { isActivated, makeCall, contractTarget, registryTarget, restoreSession } from "../lib/wallet";
import type { Config } from "../lib/chain";

const SESSION_KEY = "mg-evm-session";

function realMode(cfg: Config): Mode {
  return {
    cfg,
    sessionKey: SESSION_KEY,
    read: makeCall(cfg),
    registry: () => registryTarget(cfg),
    tokenTarget: contractTarget,
    canReceive: (address) => isActivated(cfg, address),
    restore: (saved, unlock) => restoreSession(cfg, saved, unlock),
    Login: (props) => <LoginDialog cfg={cfg} {...props} />,
    notReady: cfg.registry ? undefined : {
      blocker: "The registry address is not set in public/config.json.",
      help: <>No registry is connected yet. Deploy the EVM contract and set its <span className="mono">0x</span> address in <span className="mono">public/config.json</span>.</>,
    },
  };
}

export default function Page() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/config.json", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Config request failed");
        return r.json();
      })
      .then(setCfg)
      .catch(() => setErr(true));
  }, []);

  const mode = useMemo(() => cfg ? realMode(cfg) : null, [cfg]);

  if (mode) return <GrantsApp mode={mode} />;

  return <main><p className="empty">{err ? "Could not load public/config.json." : "Loading…"}</p></main>;
}
