"use client";
import { useState } from "react";
import { calls } from "../lib/api";
import { currentMilestone, fmt, isNative, short, timeLeft, yourMove, type GrantView } from "../lib/chain";
import Rail from "./Rail";
import MilestoneDetail, { type Run } from "./MilestoneDetail";

interface Props { g: GrantView; symbol: string; decimals: number; account: string | null; now: number; run: Run }

export default function GrantTrack({ g, symbol, decimals, account, now, run }: Props) {
  const cur = currentMilestone(g);
  const [sel, setSel] = useState(cur >= 0 ? cur : g.milestones.length - 1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sym = isNative(g.token) ? symbol : "tokens";
  const move = yourMove(g, account, now);
  const canReclaim = !g.closed && now > g.deadline && account?.toLowerCase() === g.funder.toLowerCase();
  const done = g.closed ? "Closed" : cur < 0 ? "Fully paid" : timeLeft(g.deadline, now);

  return (
    <article className="track" aria-labelledby={`g${g.id}`}>
      <header className="track-head">
        <div>
          <h3 id={`g${g.id}`}>{g.repo}</h3>
          <p className="parties">
            <span className="mono" title={g.funder}>{short(g.funder)}</span> funds <span className="mono" title={g.recipient}>{short(g.recipient)}</span>
          </p>
        </div>
        <div className="track-side">
          {move && <span className="move">Your move: {move}</span>}
          <span className="when">{done}</span>
        </div>
      </header>

      <div className="money">
        <span className="money-main"><strong>{fmt(g.released, decimals)}</strong><span>of {fmt(g.total, decimals)} {sym} released</span></span>
        <span className="quorum">{g.threshold} of {g.reviewers.length} reviewers must approve each milestone</span>
      </div>

      <Rail g={g} selected={sel} onSelect={setSel} symbol={sym} decimals={decimals} />
      <MilestoneDetail g={g} index={sel} symbol={sym} decimals={decimals} account={account} now={now} run={run} />

      {canReclaim && (
        <div className="reclaim">
          <p>The deadline passed. You can take back what was not released.</p>
          <button className="btn btn-quiet" disabled={busy} onClick={async () => {
            setBusy(true); setErr("");
            try { await run(calls.reclaim(g.id), { pending: "Reclaiming funds…", done: "Funds reclaimed." }); } catch (e) { setErr((e as Error).message); }
            setBusy(false);
          }}>Reclaim funds</button>
          {err && <p className="field-err" role="alert">{err}</p>}
        </div>
      )}
      <details className="reviewers">
        <summary>Reviewers ({g.reviewers.length})</summary>
        <ul>{g.reviewers.map((r) => <li key={r} className="mono">{r}</li>)}</ul>
      </details>
    </article>
  );
}
