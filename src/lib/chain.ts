import { calls } from "./api";
import { words, wBig, wAddr, wBytes20, decodeString } from "./abi";

export interface Config { registryAddress: string; chainId: number; chainName: string; rpcUrl: string; nativeSymbol: string; nativeDecimals: number }
export interface Eip1193 { request(a: { method: string; params?: unknown[] }): Promise<any>; on?(e: string, f: () => void): void }
export interface MilestoneView { amount: bigint; status: number; approvals: number; commit: string; evidence: string }
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
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
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

export async function readGrant(call: EthCall, id: number): Promise<GrantView> {
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
      evidence: status >= 1 ? decodeString(await call(calls.evidenceOf(id, i))) : "" });
  }
  return { id, funder: wAddr(w[0]), token: wAddr(w[1]), recipient: wAddr(w[2]), total: wBig(w[3]), released: wBig(w[4]),
    createdAt: Number(wBig(w[5])), deadline: Number(wBig(w[6])), threshold: Number(wBig(w[7])), closed: wBig(w[8]) === 1n,
    repo, reviewers, milestones };
}

export async function sendTx(eth: Eip1193 | undefined, from: string | null, to: string, data: string, value?: string): Promise<string> {
  if (!eth || !from) throw new Error("Connect a wallet first.");
  const tx = await eth.request({ method: "eth_sendTransaction",
    params: [{ from, to, data, ...(value && value !== "0" ? { value: "0x" + BigInt(value).toString(16) } : {}) }] });
  for (let i = 0; i < 90; i++) {
    const rc = await eth.request({ method: "eth_getTransactionReceipt", params: [tx] });
    if (rc) { if (rc.status !== "0x1") throw new Error("Transaction reverted on-chain."); return tx; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for confirmation (tx " + tx + ")");
}
