import { calls } from "./api";
import { words, wBig, wId, wBytes20, decodeString } from "./abi";

/** `registry` is the contract's account as a 5… address. */
export interface Config { registry?: string; rpcUrl?: string; chainId?: number; wsUrl?: string; nativeSymbol: string; nativeDecimals: number; ss58Format?: number }
export interface MilestoneView { amount: bigint; status: number; approvals: number; commit: string; evidence: string; viewerVoted?: boolean }
export interface GrantView {
  id: number; funder: string; token: string; recipient: string; total: bigint; released: bigint;
  createdAt: number; deadline: number; threshold: number; closed: boolean; repo: string;
  reviewers: string[]; milestones: MilestoneView[];
}
/** Sends read-only calldata to the registry and returns the ABI-encoded result. */
export type ContractCall = (data: string) => Promise<string>;

export const isNative = (token: string) => /^0x0+$/.test(token);
export const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
export const STATUS = ["Pending", "Claimed", "Released"];

export function parseUnits(v: string, dec: number): string {
  const m = v.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`"${v}" is not a number`);
  if ((m[2] ?? "").length > dec) throw new Error(`too many decimals in "${v}"`);
  return (BigInt(m[1]) * 10n ** BigInt(dec) + BigInt((m[2] ?? "").padEnd(dec, "0") || "0")).toString();
}
export function fmt(wei: bigint, dec: number): string {
  const s = wei.toString().padStart(dec + 1, "0"), i = s.slice(0, -dec), f = s.slice(-dec).replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
}

/** `viewer` below is an AccountId32 hex value (0x + 64 digits): the public key behind a 5… address. */
export async function readGrantCount(call: ContractCall): Promise<number> {
  return Number(wBig(words(await call(calls.grantCount()))[0]));
}

export async function readGrant(call: ContractCall, id: number, viewer?: string | null): Promise<GrantView> {
  const w = words(await call(calls.grantInfo(id)));
  const nr = Number(wBig(w[9])), nm = Number(wBig(w[10]));
  const repo = decodeString(await call(calls.repoOf(id)));
  const reviewers: string[] = [];
  for (let i = 0; i < nr; i++) reviewers.push(wId(words(await call(calls.reviewerAt(id, i)))[0]));
  const milestones: MilestoneView[] = [];
  for (let i = 0; i < nm; i++) {
    const m = words(await call(calls.milestoneInfo(id, i)));
    const status = Number(wBig(m[1]));
    milestones.push({ amount: wBig(m[0]), status, approvals: Number(wBig(m[2])), commit: wBytes20(m[3]),
      evidence: status >= 1 ? decodeString(await call(calls.evidenceOf(id, i))) : "",
      viewerVoted: viewer && status === 1 ? wBig(words(await call(calls.hasVoted(id, i, viewer)))[0]) === 1n : undefined });
  }
  return { id, funder: wId(w[0]), token: wId(w[1]), recipient: wId(w[2]), total: wBig(w[3]), released: wBig(w[4]),
    createdAt: Number(wBig(w[5])), deadline: Number(wBig(w[6])), threshold: Number(wBig(w[7])), closed: wBig(w[8]) === 1n,
    repo, reviewers, milestones };
}

/** EVM address validation. */
export const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());
export const isSs58 = isAddress;
export const isRepo = (r: string) => /^[\w.-]+\/[\w.-]+$/.test(r.trim());
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
export function timeLeft(deadline: number, now: number): string {
  const d = deadline - now, a = Math.abs(d);
  const span = a >= 172800 ? plural(Math.floor(a / 86400), "day") : a >= 3600 ? plural(Math.floor(a / 3600), "hour") : plural(Math.max(1, Math.floor(a / 60)), "minute");
  return d >= 0 ? `${span} left` : `passed ${span} ago`;
}
/** Index of the milestone the grant is currently working on (first not yet released), or -1 when all are paid. */
export const currentMilestone = (g: GrantView) => g.milestones.findIndex((m) => m.status !== 2);
/** What, if anything, the connected account can do on this grant right now. */
export function yourMove(g: GrantView, account: string | null, now: number): string | null {
  if (!account || g.closed) return null;
  const me = account.toLowerCase(), cur = currentMilestone(g);
  if (cur >= 0) {
    const m = g.milestones[cur];
    if (me === g.recipient.toLowerCase() && m.status === 0 && now <= g.deadline) return `Claim milestone ${cur + 1}`;
    if (m.status === 1 && g.reviewers.some((r) => r.toLowerCase() === me) && !m.viewerVoted) return `Review milestone ${cur + 1}`;
  }
  if (me === g.funder.toLowerCase() && now > g.deadline) return "Reclaim funds";
  return null;
}
