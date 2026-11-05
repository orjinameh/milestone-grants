// Portaldot login: three ways in, one Substrate-style account (SS58, starts with 5).
//   1. Browser extension (polkadot-js compatible, desktop browsers; Orion on mobile)
//   2. Keystore JSON + password (encrypted key, decrypted in the browser, never uploaded)
//   3. Account info JSON (public descriptor: name, address, ss58 prefix), paired with the keystore
// Reads go through the public EVM RPC. Writes are signed as Substrate extrinsics (revive.call).
import type { Config } from "./chain";

export type LoginKind = "extension" | "keystore" | "both" | "info";
export interface Wallet { kind: LoginKind; name: string; ss58: string; evm: string; send(to: string, data: string, value?: string): Promise<string> }
export interface AccountInfo { address?: string; name?: string; ss58Format?: number }

const APP = "Milestone Grants";
/** Dynamic import with a few retries. Never reloads the page. */
async function load<T>(f: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await f(); }
    catch (e) {
      if (i < 3) { await new Promise((r) => setTimeout(r, 800 * (i + 1))); continue; }
      throw new Error("Could not download the wallet code (network problem). Try again.");
    }
  }
}
const rpc = async (url: string, method: string, params: unknown[]) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result as string;
};

/** Substrate account to the 20-byte address the contract sees as msg.sender (pallet-revive default mapper). */
export async function toEvm(address: string, _cfg?: Config): Promise<string> {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return address;
  const { decodeAddress, keccakAsU8a } = await load(() => import("@polkadot/util-crypto"));
  const { u8aToHex } = await load(() => import("@polkadot/util"));
  const pk = decodeAddress(address);
  if (pk.slice(20).every((b) => b === 0xee)) return u8aToHex(pk.slice(0, 20)); // account derived from an eth address
  return u8aToHex(keccakAsU8a(pk).slice(12));
}

async function connectApi(cfg: Config) {
  if (!cfg.wsUrl) throw new Error("Set wsUrl (the Portaldot Substrate WebSocket endpoint) in public/config.json.");
  const { ApiPromise, WsProvider } = await load(() => import("@polkadot/api"));
  return ApiPromise.create({ provider: new WsProvider(cfg.wsUrl) });
}

type Signer = { address: string; name: string; signer?: any; pair?: any; viewOnly?: boolean };

async function makeWallet(kind: LoginKind, who: Signer, cfg: Config): Promise<Wallet> {
  const evm = await toEvm(who.address, cfg);
  let apiP: Promise<any> | undefined;
  const send = async (to: string, data: string, value?: string) => {
    if (who.viewOnly) throw new Error("This is a view-only login (account info file only). Log in with the extension or a keystore file to sign.");
    apiP ??= connectApi(cfg);
    const api = await apiP;
    // Revive takes value in native units; the contract sees it scaled by NativeToEthRatio.
    const ratio = api.consts.revive?.nativeToEthRatio ? BigInt(api.consts.revive.nativeToEthRatio.toString()) : 10n ** BigInt(Math.max(0, cfg.nativeDecimals - (api.registry.chainDecimals[0] ?? cfg.nativeDecimals)));
    const nativeValue = (BigInt(value ?? "0") / ratio).toString();
    // Dry run to get weight and storage deposit limits (Developer > Runtime calls > reviveApi > call).
    const dry = await api.call.reviveApi.call(who.address, to, nativeValue, null, null, data);
    if (dry.result.isErr) throw new Error("Transaction would revert (dry run failed).");
    const dep = dry.storageDeposit;
    const depositLimit = dep.isCharge ? dep.asCharge.toString() : "0";
    const tx = api.tx.revive.call(to, nativeValue, dry.gasRequired, depositLimit, data);
    return new Promise<string>((resolve, reject) => {
      tx.signAndSend(who.pair ?? who.address, who.pair ? {} : { signer: who.signer }, (res: any) => {
        if (!res.status.isInBlock && !res.status.isFinalized) return;
        if (res.dispatchError || res.events.some(({ event }: any) => api.events.system.ExtrinsicFailed.is(event))) return reject(new Error("Transaction failed on-chain."));
        resolve(tx.hash.toHex());
      }).catch(reject);
    });
  };
  return { kind, name: who.name, ss58: who.address, evm, send };
}

/** 1. Browser extension. */
export async function loginExtension(cfg: Config): Promise<Wallet[]> {
  const { web3Enable, web3Accounts } = await load(() => import("@polkadot/extension-dapp"));
  const exts = await web3Enable(APP);
  if (!exts.length) throw new Error("No Substrate wallet extension found. Install one on a desktop browser (or use Orion on mobile).");
  const accounts = await web3Accounts({ ss58Format: cfg.ss58Format ?? 42 });
  if (!accounts.length) throw new Error("The extension has no accounts, or access was declined.");
  const injector = await (await load(() => import("@polkadot/extension-dapp"))).web3FromSource(accounts[0].meta.source);
  return Promise.all(accounts.map((a) => makeWallet("extension", { address: a.address, name: a.meta.name ?? "Account", signer: injector.signer }, cfg)));
}

/** 2 + 3. Any combination of files works: keystore JSON (needs the password), account info JSON, or both. */
export async function loginFiles(cfg: Config, files: { name: string; text: string }[], password: string): Promise<Wallet> {
  let keystore: any, info: AccountInfo | undefined;
  for (const f of files) {
    let j: any;
    try { j = JSON.parse(f.text); } catch { throw new Error(`${f.name} is not valid JSON.`); }
    if (j && typeof j === "object" && "encoded" in j) keystore = j; else info = j;
  }
  if (!keystore && !info) throw new Error("Select a keystore or account info JSON file.");
  const { Keyring } = await load(() => import("@polkadot/keyring"));
  const { cryptoWaitReady } = await load(() => import("@polkadot/util-crypto"));
  await cryptoWaitReady();
  const keyring = new Keyring({ type: "sr25519", ss58Format: info?.ss58Format ?? cfg.ss58Format ?? 42 });
  if (!keystore) {
    const addr = info?.address;
    if (!addr) throw new Error("That file has no keystore and no address, so there is nothing to log in with.");
    try { keyring.decodeAddress(addr); } catch { throw new Error("The address in the account info file is not valid."); }
    return makeWallet("info", { address: addr, name: info?.name ?? "Account", viewOnly: true }, cfg);
  }
  if (!password) throw new Error("Enter the keystore password.");
  const pair = keyring.createFromJson(keystore);
  try { pair.decodePkcs8(password); } catch { throw new Error("Wrong password for this keystore."); }
  if (info?.address && info.address !== pair.address && keyring.encodeAddress(pair.publicKey) !== info.address) throw new Error("The account info file does not match this keystore.");
  return makeWallet(info ? "both" : "keystore", { address: pair.address, name: info?.name ?? keystore.meta?.name ?? "Keystore account", pair }, cfg);
}

/** Re-attach a previously chosen extension account without any prompt (returns null if not possible). */
export async function reconnectExtension(cfg: Config, ss58: string): Promise<Wallet | null> {
  try { return (await loginExtension(cfg)).find((w) => w.ss58 === ss58) ?? null; } catch { return null; }
}
