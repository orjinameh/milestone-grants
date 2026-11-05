"use client";
import { useEffect, useState } from "react";
import { calls } from "../lib/api";
import { lookupCommit, timing, type CommitEvidence } from "../lib/github";
import { fmt, STATUS, type GrantView } from "../lib/chain";

interface Props {
  g: GrantView; index: number; symbol: string; decimals: number; account: string | null;
  run: (data: string) => Promise<void>;
}

export default function MilestoneRow({ g, index, symbol, decimals, account, run }: Props) {
  const m = g.milestones[index];
  const me = account?.toLowerCase();
  const sha = m.commit.slice(2);
  const [ev, setEv] = useState<CommitEvidence | null>(null);
  const [sha_, setSha] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (m.status < 1) return;
    let live = true;
    lookupCommit(g.repo, sha).then((r) => live && setEv(r));
    return () => { live = false; };
  }, [g.repo, sha, m.status]);

  const act = async (data: string) => {
    setBusy(true); setErr("");
    try { await run(data); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const isRecipient = me === g.recipient.toLowerCase();
  const isReviewer = !!me && g.reviewers.some((r) => r.toLowerCase() === me);
  const canClaim = !g.closed && isRecipient && m.status === 0;
  const canApprove = !g.closed && isReviewer && m.status === 1;

  return (
    <div className="ms">
      <strong>Milestone {index + 1}</strong> · {fmt(m.amount, decimals)} {symbol}
      <span className="tag">{STATUS[m.status]}</span>
      {m.status === 1 && <span className="tag">{m.approvals}/{g.threshold} approvals</span>}
      {m.status >= 1 && (
        <small className={ev?.ok && ev.authoredAt! >= g.createdAt ? "ok" : ev ? "warn" : ""}>
          commit {sha}{m.evidence ? ` · ${m.evidence}` : ""} ·{" "}
          {!ev ? "checking GitHub…" : ev.ok
            ? `verified on GitHub: "${ev.message}" by ${ev.author}, ${timing(ev.authoredAt!, g.createdAt)}`
            : `not verified: ${ev.error}`}
        </small>
      )}
      {(canClaim || canApprove) && (
        <div className="row">
          {canClaim && (
            <>
              <input value={sha_} onChange={(e) => setSha(e.target.value)} placeholder="40-hex commit SHA delivering this milestone" />
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="evidence URL (PR, demo, docs)" />
              <button disabled={busy} onClick={() => {
                const s = sha_.trim().replace(/^0x/, "");
                if (!/^[0-9a-fA-F]{40}$/.test(s)) return setErr("Commit must be a 40-character hex SHA.");
                void act(calls.claim(g.id, index, "0x" + s, url.trim()));
              }}>Claim with commit</button>
            </>
          )}
          {canApprove && <button disabled={busy} onClick={() => void act(calls.approve(g.id, index))}>Approve</button>}
        </div>
      )}
      {err && <small className="bad">{err}</small>}
    </div>
  );
}
