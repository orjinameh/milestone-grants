"use client";
import type { Mode } from "../components/GrantsApp";
import type { Config } from "../lib/chain";
import { DEMO_ACCOUNTS, DEMO_REGISTRY, demoCall, initDemo, restoreDemo } from "./contract";
import { DEMO_REPO } from "./repo";
import { DemoBanner, DemoLogin, DemoSwitch } from "./DemoParts";


const cfg: Config = { wsUrl: "", nativeSymbol: "POT", nativeDecimals: 18, ss58Format: 42 };
const [, builder, ...panel] = DEMO_ACCOUNTS;

export const demoMode: Mode = {
  cfg,
  sessionKey: "mg-demo-session",
  read: demoCall,
  registry: async () => DEMO_REGISTRY,
  init: () => initDemo(DEMO_REPO),
  restore: async (saved) => (saved ? restoreDemo(saved) : null),
  Login: DemoLogin,
  AccountSwitch: DemoSwitch,
  Banner: DemoBanner,
  example: { recipient: builder.ss58, repo: DEMO_REPO, amounts: ["1", "2"], reviewers: panel.map((a) => a.ss58), threshold: 2, days: 14 },
};
