// Real evidence check: does the anchored commit exist in the grant's GitHub repo, and when was it authored
// relative to the grant's creation? Uses the public GitHub REST API (unauthenticated, 60 req/h per IP).
export interface CommitEvidence { ok: boolean; message?: string; author?: string; authoredAt?: number; error?: string }
export async function lookupCommit(repo: string, sha: string, fetchImpl: typeof fetch = fetch): Promise<CommitEvidence> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ok: false, error: "repo is not owner/name" };
  if (!/^[0-9a-f]{40}$/i.test(sha)) return { ok: false, error: "not a 40-hex commit" };
  try {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/commits/${sha}`, { headers: { accept: "application/vnd.github+json" } });
    if (r.status === 404 || r.status === 422) return { ok: false, error: "commit not found in repo" };
    if (r.status === 403 || r.status === 429) return { ok: false, error: "GitHub rate limit; try later" };
    if (!r.ok) return { ok: false, error: `GitHub HTTP ${r.status}` };
    const j: any = await r.json();
    return { ok: true, message: String(j.commit?.message ?? "").split("\n")[0], author: j.commit?.author?.name,
      authoredAt: Math.floor(Date.parse(j.commit?.author?.date) / 1000) };
  } catch (e) { return { ok: false, error: "network error reaching GitHub" }; }
}
export function timing(authoredAt: number, grantCreatedAt: number): string {
  const d = (authoredAt - grantCreatedAt) / 86400;
  return d < 0 ? `authored ${(-d).toFixed(1)} days BEFORE the grant was created` : `authored ${d.toFixed(1)} days after the grant was created`;
}
