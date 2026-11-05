"use client";
import { useState } from "react";
import { calls } from "../lib/api";
import { fmt, isNative, type GrantView } from "../lib/chain";
import MilestoneRow from "./MilestoneRow";

interface Props {
  g: GrantView; symbol: string; decimals: number; account: string | null; now: number;
  run: (data: string) => Promise<void>;
}

export default function GrantCard({ g, symbol, decimals, account, now, run }: Props) {
  const sym = isNative(g.token) ? symbol : "tokens";
  const pct = g.total > 0n ? Number((g.released * 100n) / g.total) : 0;
  const canReclaim = !g.closed && now > g.deadline && account?.toLowerCase() === g.funder.toLowerCase();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  return (
    <div className="card grant">
      <h3>Grant #{g.id} · {g.repo} {g.closed && <span className="tag">closed</span>}</h3>
      <div className="meta">
        recipient {g.recipient}<br />funder {g.funder}<br />
        {g.threshold}-of-{g.reviewers.length} reviewers · deadline {new Date(g.deadline * 1000).toLocaleString()}
        {now > g.deadline ? " (passed)" : ""}
      </div>
      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
      <div>{fmt(g.released, decimals)} / {fmt(g.total, decimals)} {sym} released</div>
      {g.milestones.map((_, i) => (
        <MilestoneRow key={i} g={g} index={i} symbol={sym} decimals={decimals} account={account} run={run} />
      ))}
      {canReclaim && (
        <button className="ghost" disabled={busy} onClick={async () => {
          setBusy(true); setErr("");
          try { await run(calls.reclaim(g.id)); } catch (e) { setErr((e as Error).message); setBusy(false); }
        }}>Reclaim unreleased funds</button>
      )}
      {err && <small className="bad">{err}</small>}
      <div className="meta">reviewers: {g.reviewers.join(", ")}</div>
    </div>
  );
}
