import { calls } from "./api";
import { words, wBig, wAddr, wBytes20, decodeString } from "./abi";

export interface Config { registryAddress: string; chainId: number; chainName: string; rpcUrl: string; nativeSymbol: string; nativeDecimals: number; wsUrl?: string; ss58Format?: number }
export interface Eip1193 { request(a: { method: string; params?: unknown[] }): Promise<any>; on?(e: string, f: () => void): void }
export interface MilestoneView { amount: bigint; status: number; approvals: number; commit: string; evidence: string; viewerVoted?: boolean }
export interface GrantView {
  id: number; funder: string; token: string; recipient: string; total: bigint; released: bigint;
  createdAt: number; deadline: number; threshold: number; closed: boolean; repo: string;
  reviewers: string[]; milestones: MilestoneView[];
}
export type EthCall = (data: string) => Promise<string>;

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

/** Public RPC first, wallet provider as fallback. Failures are surfaced, never papered over. */
export function makeEthCall(cfg: Config, eth: Eip1193 | undefined, walletOnRightChain: boolean): EthCall {
  return async (data) => {
    const params = [{ to: cfg.registryAddress, data }, "latest"];
    try {
      const r = await fetch(cfg.rpcUrl, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params }) });
      if (!r.ok) throw new Error(`RPC returned HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || "RPC error");
      if (typeof j.result !== "string") throw new Error("RPC gave no result for eth_call");
      if (j.result === "0x") throw new Error(`No contract found at ${cfg.registryAddress} on ${cfg.chainName} (deploy it, then set registryAddress)`);
      return j.result;
    } catch (e) {
      if (eth && walletOnRightChain) return eth.request({ method: "eth_call", params });
      throw e;
    }
  };
}

export async function readGrantCount(call: EthCall): Promise<number> {
  return Number(wBig(words(await call(calls.grantCount()))[0]));
}

export async function readGrant(call: EthCall, id: number, viewer?: string | null): Promise<GrantView> {
  const w = words(await call(calls.grantInfo(id)));
  const nr = Number(wBig(w[9])), nm = Number(wBig(w[10]));
  const repo = decodeString(await call(calls.repoOf(id)));
  const reviewers: string[] = [];
  for (let i = 0; i < nr; i++) reviewers.push(wAddr(words(await call(calls.reviewerAt(id, i)))[0]));
  const milestones: MilestoneView[] = [];
  for (let i = 0; i < nm; i++) {
    const m = words(await call(calls.milestoneInfo(id, i)));
    const status = Number(wBig(m[1]));
    milestones.push({ amount: wBig(m[0]), status, approvals: Number(wBig(m[2])), commit: wBytes20(m[3]),
      evidence: status >= 1 ? decodeString(await call(calls.evidenceOf(id, i))) : "",
      viewerVoted: viewer && status === 1 ? wBig(words(await call(calls.voted(id, i, viewer)))[0]) === 1n : undefined });
  }
  return { id, funder: wAddr(w[0]), token: wAddr(w[1]), recipient: wAddr(w[2]), total: wBig(w[3]), released: wBig(w[4]),
    createdAt: Number(wBig(w[5])), deadline: Number(wBig(w[6])), threshold: Number(wBig(w[7])), closed: wBig(w[8]) === 1n,
    repo, reviewers, milestones };
}

export async function sendTx(eth: Eip1193 | undefined, from: string | null, to: string, data: string, value?: string): Promise<string> {
  if (!eth || !from) throw new Error("Log in first.");
  const tx = await eth.request({ method: "eth_sendTransaction",
    params: [{ from, to, data, ...(value && value !== "0" ? { value: "0x" + BigInt(value).toString(16) } : {}) }] });
  for (let i = 0; i < 90; i++) {
    const rc = await eth.request({ method: "eth_getTransactionReceipt", params: [tx] });
    if (rc) { if (rc.status !== "0x1") throw new Error("Transaction reverted on-chain."); return tx; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for confirmation (tx " + tx + ")");
}

export const isSs58 = (a: string) => /^5[1-9A-HJ-NP-Za-km-z]{46,47}$/.test(a.trim());
export const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim()) || isSs58(a);
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
