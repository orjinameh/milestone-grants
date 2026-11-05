"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { calls } from "../src/lib/api";
import {
  fmt, isNative, makeEthCall, parseUnits, readGrant, readGrantCount, sendTx, short,
  type Config, type Eip1193, type GrantView,
} from "../src/lib/chain";
import GrantCard from "../components/GrantCard";

type Msg = { text: string; cls: string };
const ZERO = "0x" + "00".repeat(20);

export default function Page() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [eth, setEth] = useState<Eip1193 | undefined>();
  const [account, setAccount] = useState<string | null>(null);
  const [chainOk, setChainOk] = useState(false);
  const [net, setNet] = useState<Msg>({ text: "Loading…", cls: "" });
  const [list, setList] = useState<Msg>({ text: "Loading grants…", cls: "" });
  const [grants, setGrants] = useState<GrantView[]>([]);
  const [create, setCreate] = useState<Msg>({ text: "", cls: "" });
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ recipient: "", repo: "", amounts: "", reviewers: "", threshold: "1", days: "14", token: "" });
  const now = Math.floor(Date.now() / 1000);

  useEffect(() => {
    setEth((window as any).ethereum);
    fetch("/config.json", { cache: "no-store" }).then((r) => r.json()).then((c: Config) => {
      setCfg(c);
      setNet({ text: (window as any).ethereum ? "Wallet not connected." : "No wallet detected. You can browse grants, but need a wallet (e.g. MetaMask) to act.", cls: (window as any).ethereum ? "" : "warn" });
    }).catch(() => setNet({ text: "Could not load config.json", cls: "bad" }));
  }, []);

  const load = useCallback(async () => {
    if (!cfg) return;
    if (!cfg.registryAddress) { setGrants([]); return setList({ text: "Registry address not configured yet (public/config.json). Nothing to show.", cls: "warn" }); }
    try {
      const call = makeEthCall(cfg, eth, chainOk);
      const n = await readGrantCount(call);
      if (n === 0) { setGrants([]); return setList({ text: "No grants on-chain yet. Create the first one above.", cls: "" }); }
      const ids: number[] = [];
      for (let id = n - 1; id >= Math.max(0, n - 20); id--) ids.push(id);
      setGrants(await Promise.all(ids.map((id) => readGrant(call, id))));
      setList({ text: `${n} grant${n === 1 ? "" : "s"} on-chain.`, cls: "" });
    } catch (e) {
      setGrants([]);
      setList({ text: `Could not read the chain (${(e as Error).message}). Check the RPC and registry address.`, cls: "bad" });
    }
  }, [cfg, eth, chainOk]);
  useEffect(() => { void load(); }, [load]);

  const connect = async () => {
    if (!eth || !cfg) return;
    try {
      const [a] = await eth.request({ method: "eth_requestAccounts" });
      const id = parseInt(await eth.request({ method: "eth_chainId" }), 16);
      setAccount(a); setChainOk(id === cfg.chainId);
      setNet({ text: `${short(a)} on chain ${id}${id === cfg.chainId ? "" : " — wrong network"}`, cls: id === cfg.chainId ? "ok" : "bad" });
      eth.on?.("chainChanged", () => location.reload());
    } catch { setNet({ text: "Wallet connection rejected.", cls: "bad" }); }
  };
  const switchNetwork = async () => {
    if (!eth || !cfg) return;
    try {
      await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x" + cfg.chainId.toString(16), chainName: cfg.chainName,
        rpcUrls: [cfg.rpcUrl], nativeCurrency: { name: cfg.nativeSymbol, symbol: cfg.nativeSymbol, decimals: cfg.nativeDecimals } }] });
      await connect();
    } catch { setNet({ text: "Network switch rejected.", cls: "bad" }); }
  };

  const run = async (data: string) => {
    if (!cfg) return;
    await sendTx(eth, account, cfg.registryAddress, data);
    await load();
  };

  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const totalHint = useMemo(() => {
    if (!cfg) return "";
    try {
      const amts = split(form.amounts);
      if (!amts.length) return "";
      const t = amts.reduce((s, a) => s + BigInt(parseUnits(a, cfg.nativeDecimals)), 0n);
      return `Total locked: ${fmt(t, cfg.nativeDecimals)} ${form.token.trim() ? "token units (assumes 18 decimals)" : cfg.nativeSymbol}`;
    } catch { return ""; }
  }, [form.amounts, form.token, cfg]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cfg) return;
    setBusy(true);
    try {
      const amounts = split(form.amounts).map((a) => parseUnits(a, cfg.nativeDecimals));
      const total = amounts.reduce((s, a) => s + BigInt(a), 0n).toString();
      const token = form.token.trim() || ZERO;
      const native = isNative(token);
      const deadline = Math.floor(Date.now() / 1000) + Math.round(Number(form.days) * 86400);
      if (!native) {
        setCreate({ text: "Step 1/2: approve the token transfer in your wallet…", cls: "" });
        await sendTx(eth, account, token, calls.erc20Approve(cfg.registryAddress, total));
      }
      setCreate({ text: native ? "Confirm the transaction in your wallet…" : "Step 2/2: confirm grant creation…", cls: "" });
      const tx = await sendTx(eth, account, cfg.registryAddress, calls.createGrant({
        token, recipient: form.recipient.trim(), deadline, threshold: Number(form.threshold), repo: form.repo.trim(),
        reviewers: split(form.reviewers), amounts }), native ? total : "0");
      setCreate({ text: `Grant created. tx ${tx}`, cls: "ok" });
      await load();
    } catch (err) { setCreate({ text: (err as Error).message, cls: "bad" }); }
    setBusy(false);
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <main>
      <header>
        <h1>Milestone Grants</h1>
        <p className="sub">Fund builders milestone by milestone on Portaldot. Each milestone is claimed with a real git commit, approved by a reviewer panel, and paid out on-chain automatically.</p>
        <p className={`status ${net.cls}`}>{net.text}</p>
        <div className="row">
          <button onClick={connect} disabled={!eth}>Connect wallet</button>
          {account && !chainOk && <button className="ghost" onClick={switchNetwork}>Switch to Portaldot testnet</button>}
        </div>
      </header>

      <section className="card">
        <h2>Create a grant</h2>
        <form onSubmit={submit}>
          <label>Recipient address<input value={form.recipient} onChange={set("recipient")} placeholder="0x…" required /></label>
          <label>GitHub repo (owner/name)<input value={form.repo} onChange={set("repo")} placeholder="owner/repo" required /></label>
          <label>Milestone amounts (comma separated)<input value={form.amounts} onChange={set("amounts")} placeholder="1, 2, 2" required /></label>
          <label>Reviewers (comma separated addresses)<input value={form.reviewers} onChange={set("reviewers")} placeholder="0x…, 0x…" required /></label>
          <label>Approvals needed<input type="number" min={1} value={form.threshold} onChange={set("threshold")} required /></label>
          <label>Deadline (days from now)<input type="number" min={1} value={form.days} onChange={set("days")} required /></label>
          <label>Token (blank = native POT, or an ERC-20 address)<input value={form.token} onChange={set("token")} placeholder="blank for POT" /></label>
          <p className="hint">{totalHint}</p>
          <button type="submit" disabled={busy || !(account && chainOk && cfg?.registryAddress)}>Fund and create grant</button>
        </form>
        <p className={`status ${create.cls}`}>{create.text}</p>
      </section>

      <section>
        <h2>Grants</h2>
        <p className={`status ${list.cls}`}>{list.text}</p>
        {cfg && grants.map((g) => (
          <GrantCard key={g.id} g={g} symbol={cfg.nativeSymbol} decimals={cfg.nativeDecimals} account={account} now={now} run={run} />
        ))}
      </section>
      <footer><p>All data is read from the contract. Commit evidence is checked live against GitHub&apos;s public API.</p></footer>
    </main>
  );
}
