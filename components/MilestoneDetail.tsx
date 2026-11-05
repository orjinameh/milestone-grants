"use client";
import { useState } from "react";
import { calls } from "../lib/api";
import { fmt, STATUS, type GrantView } from "../lib/chain";
import EvidenceStamp from "./EvidenceStamp";

export type Run = (data: string, label: { pending: string; done: string }) => Promise<void>;
interface Props { g: GrantView; index: number; symbol: string; decimals: number; account: string | null; now: number; run: Run }

export default function MilestoneDetail({ g, index, symbol, decimals, account, now, run }: Props) {
  const m = g.milestones[index];
  const me = account?.toLowerCase();
  const [sha, setSha] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const isRecipient = me === g.recipient.toLowerCase();
  const isReviewer = !!me && g.reviewers.some((r) => r.toLowerCase() === me);
  const prevPaid = index === 0 || g.milestones[index - 1].status === 2;
  const open = !g.closed && now <= g.deadline;
  const needed = Math.max(0, g.threshold - m.approvals);

  const go = async (data: string, label: { pending: string; done: string }) => {
    setBusy(true); setErr("");
    try { await run(data, label); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const cleanSha = sha.trim().replace(/^0x/, "");
  const shaValid = /^[0-9a-fA-F]{40}$/.test(cleanSha);

  let headline = "";
  if (m.status === 2) headline = `${fmt(m.amount, decimals)} ${symbol} was paid to the recipient.`;
  else if (m.status === 1) headline = needed > 0 ? `Waiting for ${needed} more approval${needed === 1 ? "" : "s"}.` : "Approved.";
  else if (g.closed) headline = "This grant is closed. Nothing was claimed for this milestone.";
  else if (!prevPaid) headline = `Unlocks once milestone ${index} is paid.`;
  else headline = open ? "Waiting for the recipient to claim it with a commit." : "The deadline passed before this was claimed.";

  return (
    <div className="detail" aria-live="polite">
      <div className="detail-head">
        <h4>Milestone {index + 1} of {g.milestones.length}</h4>
        <span className={`state state-${m.status}`}>{STATUS[m.status]}</span>
      </div>
      <p className="detail-line">{headline}</p>

      {m.status >= 1 && <EvidenceStamp repo={g.repo} sha={m.commit.slice(2)} evidence={m.evidence} grantCreatedAt={g.createdAt} />}

      {!g.closed && m.status === 0 && prevPaid && open && isRecipient && (
        <form className="act" onSubmit={(e) => { e.preventDefault(); if (shaValid) void go(calls.claim(g.id, index, "0x" + cleanSha, url.trim()), { pending: "Submitting your claim…", done: "Milestone claimed." }); }}>
          <label>Commit that delivers this milestone
            <input className="mono" value={sha} onChange={(e) => setSha(e.target.value)} placeholder="40-character commit SHA" spellCheck={false} aria-invalid={sha !== "" && !shaValid} />
          </label>
          {sha !== "" && !shaValid && <p className="field-err">A commit SHA has exactly 40 hex characters.</p>}
          <label>Link to the pull request or demo (optional)
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </label>
          <button className="btn" disabled={busy || !shaValid}>Claim milestone</button>
        </form>
      )}

      {!g.closed && m.status === 1 && isReviewer && (
        m.viewerVoted
          ? <p className="note">You approved this milestone.</p>
          : <div className="act"><button className="btn" disabled={busy} onClick={() => void go(calls.approve(g.id, index), { pending: "Submitting your approval…", done: "Approved." })}>Approve</button></div>
      )}
      {err && <p className="field-err" role="alert">{err}</p>}
    </div>
  );
}
