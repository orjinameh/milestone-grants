import { calls } from "../src/lib/api.js";
import { words, wBig, wAddr, wBytes20, decodeString } from "../src/lib/abi.js";
import { lookupCommit, timing } from "../src/lib/github.js";

interface Config { registryAddress: string; chainId: number; chainName: string; rpcUrl: string; nativeSymbol: string; nativeDecimals: number }
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const eth = (window as any).ethereum as undefined | { request(a: { method: string; params?: unknown[] }): Promise<any>; on?(e: string, f: () => void): void };
let cfg: Config, account: string | null = null, chainOk = false;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const setStatus = (id: string, t: string, cls = "") => { const e = $(id); e.textContent = t; e.className = ("status " + cls).trim(); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);

function parseUnits(v: string, dec: number): string {
  const m = v.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`"${v}" is not a number`);
  const frac = (m[2] ?? "").padEnd(dec, "0");
  if ((m[2] ?? "").length > dec) throw new Error(`too many decimals in "${v}"`);
  return (BigInt(m[1]) * 10n ** BigInt(dec) + BigInt(frac || "0")).toString();
}
function fmt(wei: bigint, dec: number): string {
  const s = wei.toString().padStart(dec + 1, "0"), i = s.slice(0, -dec), f = s.slice(-dec).replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
}

// Reads: public RPC first, wallet provider as fallback. Failure is surfaced, never papered over.
async function rpc(method: string, params: unknown[]): Promise<any> {
  try {
    const r = await fetch(cfg.rpcUrl, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  } catch (e) {
    if (eth && chainOk) return eth.request({ method, params });
    throw e;
  }
}
const ethCall = (data: string) => rpc("eth_call", [{ to: cfg.registryAddress, data }, "latest"]);

async function init() {
  cfg = await (await fetch("config.json", { cache: "no-store" })).json();
  $("btn-connect").onclick = connect;
  $("btn-network").onclick = switchNetwork;
  $<HTMLFormElement>("form").onsubmit = (e) => { e.preventDefault(); createGrant(); };
  $("form").addEventListener("input", updateTotal);
  if (!eth) setStatus("net", "No wallet detected. You can browse grants, but need a wallet (e.g. MetaMask) to act.", "warn");
  else setStatus("net", "Wallet not connected.");
  await loadGrants();
}

async function connect() {
  if (!eth) return;
  try {
    const [a] = await eth.request({ method: "eth_requestAccounts" });
    account = a;
    const id = parseInt(await eth.request({ method: "eth_chainId" }), 16);
    chainOk = id === cfg.chainId;
    setStatus("net", `${short(a)} on chain ${id}${chainOk ? "" : " — wrong network"}`, chainOk ? "ok" : "bad");
    $("btn-network").hidden = chainOk;
    eth.on?.("chainChanged", () => location.reload());
    $<HTMLButtonElement>("btn-create").disabled = !(chainOk && cfg.registryAddress);
    await loadGrants();
  } catch { setStatus("net", "Wallet connection rejected.", "bad"); }
}
async function switchNetwork() {
  if (!eth) return;
  try {
    await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x" + cfg.chainId.toString(16), chainName: cfg.chainName,
      rpcUrls: [cfg.rpcUrl], nativeCurrency: { name: cfg.nativeSymbol, symbol: cfg.nativeSymbol, decimals: cfg.nativeDecimals } }] });
    await connect();
  } catch { setStatus("net", "Network switch rejected.", "bad"); }
}

async function sendTx(to: string, data: string, value?: string): Promise<string> {
  if (!eth || !account) throw new Error("Connect a wallet first.");
  const tx = await eth.request({ method: "eth_sendTransaction", params: [{ from: account, to, data, ...(value && value !== "0" ? { value: "0x" + BigInt(value).toString(16) } : {}) }] });
  for (let i = 0; i < 90; i++) {
    const rc = await eth.request({ method: "eth_getTransactionReceipt", params: [tx] });
    if (rc) { if (rc.status !== "0x1") throw new Error("Transaction reverted on-chain."); return tx; }
    await sleep(2000);
  }
  throw new Error("Timed out waiting for confirmation (tx " + tx + ")");
}

function formValues() {
  const f = $<HTMLFormElement>("form"), d = new FormData(f), g = (k: string) => String(d.get(k) ?? "").trim();
  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const token = g("token") || "0x" + "00".repeat(20);
  return { recipient: g("recipient"), repo: g("repo"), amounts: split(g("amounts")), reviewers: split(g("reviewers")),
    threshold: Number(g("threshold")), days: Number(g("days")), token };
}
function updateTotal() {
  try {
    const v = formValues();
    const total = v.amounts.reduce((s, a) => s + BigInt(parseUnits(a, cfg.nativeDecimals)), 0n);
    $("total").textContent = v.amounts.length ? `Total locked: ${fmt(total, cfg.nativeDecimals)} ${v.token.replace(/0/g, "") === "x" ? cfg.nativeSymbol : "token units (assumes 18 decimals)"}` : "";
  } catch { $("total").textContent = ""; }
}

async function createGrant() {
  const btn = $<HTMLButtonElement>("btn-create"); btn.disabled = true;
  try {
    const v = formValues();
    const amounts = v.amounts.map((a) => parseUnits(a, cfg.nativeDecimals));
    const total = amounts.reduce((s, a) => s + BigInt(a), 0n).toString();
    const native = /^0x0+$/.test(v.token);
    const deadline = Math.floor(Date.now() / 1000) + Math.round(v.days * 86400);
    if (!native) {
      setStatus("create-status", "Step 1/2: approve the token transfer in your wallet…");
      await sendTx(v.token, calls.erc20Approve(cfg.registryAddress, total));
    }
    setStatus("create-status", native ? "Confirm the transaction in your wallet…" : "Step 2/2: confirm grant creation…");
    const tx = await sendTx(cfg.registryAddress, calls.createGrant({ token: v.token, recipient: v.recipient, deadline, threshold: v.threshold, repo: v.repo, reviewers: v.reviewers, amounts }), native ? total : "0");
    setStatus("create-status", `Grant created. tx ${tx}`, "ok");
    await loadGrants();
  } catch (e) { setStatus("create-status", (e as Error).message, "bad"); }
  btn.disabled = !(chainOk && cfg.registryAddress);
}

const STATUS = ["Pending", "Claimed", "Released"];
async function loadGrants() {
  const box = $("grants"); box.innerHTML = "";
  if (!cfg.registryAddress) return setStatus("list-status", "Registry address not configured yet (web/config.json). Nothing to show.", "warn");
  try {
    const n = Number(wBig(words(await ethCall(calls.grantCount()))[0]));
    if (n === 0) return setStatus("list-status", "No grants on-chain yet. Create the first one above.");
    setStatus("list-status", `${n} grant${n === 1 ? "" : "s"} on-chain.`);
    for (let id = n - 1; id >= Math.max(0, n - 20); id--) box.appendChild(await renderGrant(id));
  } catch (e) { setStatus("list-status", `Could not read the chain (${(e as Error).message}). Check the RPC and registry address.`, "bad"); }
}

async function renderGrant(id: number): Promise<HTMLElement> {
  const w = words(await ethCall(calls.grantInfo(id)));
  const g = { funder: wAddr(w[0]), token: wAddr(w[1]), recipient: wAddr(w[2]), total: wBig(w[3]), released: wBig(w[4]), createdAt: Number(wBig(w[5])),
    deadline: Number(wBig(w[6])), threshold: Number(wBig(w[7])), closed: wBig(w[8]) === 1n, nr: Number(wBig(w[9])), nm: Number(wBig(w[10])) };
  const repo = decodeString(await ethCall(calls.repoOf(id)));
  const reviewers: string[] = [];
  for (let i = 0; i < g.nr; i++) reviewers.push(wAddr(words(await ethCall(calls.reviewerAt(id, i)))[0]));
  const native = /^0x0+$/.test(g.token), sym = native ? cfg.nativeSymbol : "tokens";
  const me = account?.toLowerCase();
  const pct = g.total > 0n ? Number((g.released * 100n) / g.total) : 0;
  const now = Math.floor(Date.now() / 1000);

  const el = document.createElement("div"); el.className = "card grant";
  el.innerHTML = `<h3>Grant #${id} · ${esc(repo)} ${g.closed ? '<span class="tag">closed</span>' : ""}</h3>
    <div class="meta">recipient ${esc(g.recipient)}<br>funder ${esc(g.funder)}<br>${g.threshold}-of-${g.nr} reviewers · deadline ${new Date(g.deadline * 1000).toLocaleString()}${now > g.deadline ? " (passed)" : ""}</div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div>${fmt(g.released, cfg.nativeDecimals)} / ${fmt(g.total, cfg.nativeDecimals)} ${esc(sym)} released</div>`;

  for (let i = 0; i < g.nm; i++) {
    const m = words(await ethCall(calls.milestoneInfo(id, i)));
    const ms = { amount: wBig(m[0]), status: Number(wBig(m[1])), approvals: Number(wBig(m[2])), commit: wBytes20(m[3]) };
    const row = document.createElement("div"); row.className = "ms";
    row.innerHTML = `<strong>Milestone ${i + 1}</strong> · ${fmt(ms.amount, cfg.nativeDecimals)} ${esc(sym)} <span class="tag">${STATUS[ms.status]}</span>${ms.status === 1 ? ` <span class="tag">${ms.approvals}/${g.threshold} approvals</span>` : ""}`;
    if (ms.status >= 1) {
      const evidence = decodeString(await ethCall(calls.evidenceOf(id, i)));
      const sha = ms.commit.slice(2);
      const ev = document.createElement("small"); ev.textContent = `commit ${sha}${evidence ? " · " + evidence : ""} · checking GitHub…`; row.appendChild(ev);
      lookupCommit(repo, sha).then((r) => {
        ev.textContent = `commit ${sha}${evidence ? " · " + evidence : ""} · ` +
          (r.ok ? `verified on GitHub: "${r.message}" by ${r.author}, ${timing(r.authoredAt!, g.createdAt)}` : `not verified: ${r.error}`);
        ev.className = r.ok && r.authoredAt! >= g.createdAt ? "ok" : "warn";
      });
    }
    const actions = document.createElement("div"); actions.className = "row";
    const act = (label: string, data: string) => {
      const b = document.createElement("button"); b.textContent = label;
      b.onclick = async () => { b.disabled = true; try { await sendTx(cfg.registryAddress, data); await loadGrants(); } catch (e) { setStatus("list-status", (e as Error).message, "bad"); b.disabled = false; } };
      actions.appendChild(b);
    };
    if (!g.closed && me) {
      if (me === g.recipient.toLowerCase() && ms.status === 0) addClaim(actions, id, i);
      if (ms.status === 1 && reviewers.some((r) => r.toLowerCase() === me)) act("Approve", calls.approve(id, i));
    }
    if (actions.children.length) row.appendChild(actions);
    el.appendChild(row);
  }
  if (!g.closed && me === g.funder.toLowerCase() && now > g.deadline) {
    const b = document.createElement("button"); b.className = "ghost"; b.textContent = "Reclaim unreleased funds";
    b.onclick = async () => { b.disabled = true; try { await sendTx(cfg.registryAddress, calls.reclaim(id)); await loadGrants(); } catch (e) { setStatus("list-status", (e as Error).message, "bad"); b.disabled = false; } };
    el.appendChild(b);
  }
  const rv = document.createElement("div"); rv.className = "meta"; rv.textContent = "reviewers: " + reviewers.join(", "); el.appendChild(rv);
  return el;
}

function addClaim(host: HTMLElement, id: number, i: number) {
  const sha = document.createElement("input"); sha.placeholder = "40-hex commit SHA delivering this milestone";
  const ev = document.createElement("input"); ev.placeholder = "evidence URL (PR, demo, docs)";
  const b = document.createElement("button"); b.textContent = "Claim with commit";
  b.onclick = async () => {
    b.disabled = true;
    try {
      const s = sha.value.trim().replace(/^0x/, "");
      if (!/^[0-9a-fA-F]{40}$/.test(s)) throw new Error("Commit must be a 40-character hex SHA.");
      await sendTx(cfg.registryAddress, calls.claim(id, i, "0x" + s, ev.value.trim()));
      await loadGrants();
    } catch (e) { setStatus("list-status", (e as Error).message, "bad"); b.disabled = false; }
  };
  host.append(sha, ev, b);
}

init();
