"use client";
import { useEffect, useState } from "react";
import { lookupCommit, timing, type CommitEvidence } from "../lib/github";
import { Alert, Check, Link } from "./Icons";

interface Props { repo: string; sha: string; evidence: string; grantCreatedAt: number }

/** Live check of the anchored commit against GitHub. Never shows a verified state without a real response. */
export default function EvidenceStamp({ repo, sha, evidence, grantCreatedAt }: Props) {
  const [ev, setEv] = useState<CommitEvidence | null>(null);
  useEffect(() => {
    let live = true;
    setEv(null);
    lookupCommit(repo, sha).then((r) => live && setEv(r));
    return () => { live = false; };
  }, [repo, sha]);

  const early = ev?.ok && ev.authoredAt! < grantCreatedAt;
  const tone = !ev ? "wait" : !ev.ok ? "bad" : early ? "warn" : "ok";
  return (
    <div className={`stamp stamp-${tone}`} role="status">
      <span className="stamp-icon">{tone === "ok" ? <Check /> : tone === "wait" ? <span className="spin" /> : <Alert />}</span>
      <div className="stamp-body">
        <p className="stamp-title">
          {!ev && "Checking the commit on GitHub"}
          {ev && !ev.ok && "Could not verify this commit"}
          {ev?.ok && !early && "Commit found on GitHub"}
          {early && "Commit predates this grant"}
        </p>
        {ev?.ok && <p className="stamp-msg">“{ev.message}” by {ev.author}</p>}
        {ev?.ok && <p className="stamp-sub">{timing(ev.authoredAt!, grantCreatedAt)}</p>}
        {ev && !ev.ok && <p className="stamp-sub">{ev.error}</p>}
        <p className="stamp-hash mono">{sha}</p>
        <p className="stamp-links">
          <a href={`https://github.com/${repo}/commit/${sha}`} target="_blank" rel="noreferrer">View commit <Link /></a>
          {/^https?:\/\//.test(evidence) && <a href={evidence} target="_blank" rel="noreferrer">Evidence <Link /></a>}
        </p>
      </div>
    </div>
  );
}
