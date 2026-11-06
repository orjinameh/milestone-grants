// Portaldot login: three ways in, one Substrate-style account (SS58, starts with 5).
//   1. Browser extension (polkadot-js compatible, desktop browsers; Orion on mobile)
//   2. Keystore JSON + password (encrypted key, decrypted in the browser, never uploaded)
//   3. Account info JSON (public descriptor: name, address, ss58 prefix). Works alone (view-only) or paired with the keystore.
// Either JSON file logs you in, in any order, one at a time or together. The login survives a page refresh
// (extension: re-attached silently; keystore: the still-encrypted file is kept in localStorage and the password
// is asked again only when you sign).
// Everything is native: reads are `reviveApi.call` dry runs and writes are signed `revive.call` extrinsics, both over the
// Substrate WebSocket (wsUrl). No Ethereum RPC is involved.
import type { Config, ContractCall } from "./chain";


export type LoginKind = "extension" | "keystore" | "both" | "info";
/** What is kept in localStorage to restore a login after a refresh. Never holds a decrypted key or a password. */
export interface Session { kind: string; address: string; name: string; ss58Format?: number; keystore?: any }
/** Asks the user for the keystore password; `attempt` throws on a wrong one so the dialog can show it and retry. */
export type Unlocker = (attempt: (password: string) => void) => Promise<void>;
/** `id` is the account's 32-byte AccountId32 as hex (the public key behind `ss58`); it is what the contract stores. */
export interface Wallet { kind: string; name: string; ss58: string; id: string; session: Session; send(to: string, data: string, value?: string): Promise<string>; activate?(): Promise<string> }
export interface AccountInfo { address?: string; name?: string; ss58Format?: number }
export interface ParsedFile { kind: "keystore" | "info"; keystore?: any; info?: AccountInfo }

const APP = "Milestone Grants";
/** Lazy import. Retries only real chunk download failures; any other error is passed through untouched. */
async function load<T>(f: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await f(); }
    catch (e) {
      const chunk = /Loading chunk|ChunkLoadError|Loading CSS chunk/i.test(String((e as Error)?.message ?? e));
      if (!chunk || i >= 3) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}
/** 5… address to the 32-byte AccountId32 hex the contract takes. */
export async function toAccountId(address: string): Promise<string> {
  const { decodeAddress } = await load(() => import("@polkadot/util-crypto"));
  const { u8aToHex } = await load(() => import("@polkadot/util"));
  try { return u8aToHex(decodeAddress(address.trim())); } catch { throw new Error(`"${address.trim()}" is not a valid Substrate address.`); }
}
/** AccountId32 hex back to a 5… address. */
export async function fromAccountId(id: string, ss58Format: number): Promise<string> {
  const { encodeAddress } = await load(() => import("@polkadot/util-crypto"));
  const { hexToU8a } = await load(() => import("@polkadot/util"));
  return encodeAddress(hexToU8a(id), ss58Format);
}
/** Plumbing only, never shown: a contract's account is its 20-byte address plus 12 bytes of 0xEE, and revive.call
 *  needs the 20-byte form as its target. Rejects accounts that are not contracts. */
export async function contractTarget(address: string): Promise<string> {
  const { decodeAddress } = await load(() => import("@polkadot/util-crypto"));
  const { u8aToHex } = await load(() => import("@polkadot/util"));
  let pk: Uint8Array;
  try { pk = decodeAddress(address.trim()); } catch { throw new Error(`"${address.trim()}" is not a valid Substrate address.`); }
  if (!pk.slice(20).every((b) => b === 0xee)) throw new Error("That address is not a token contract.");
  return u8aToHex(pk.slice(0, 20));
}

async function connectApi(cfg: Config) {
  if (!cfg.wsUrl) throw new Error("Set wsUrl (the Portaldot Substrate WebSocket endpoint) in public/config.json.");
  const { ApiPromise, WsProvider } = await load(() => import("@polkadot/api"));
  return ApiPromise.create({ provider: new WsProvider(cfg.wsUrl) });
}
/** One shared connection for reads and writes. A failed connection is not cached, so the next call retries. */
const apis = new Map<string, Promise<any>>();
function getApi(cfg: Config): Promise<any> {
  let p = apis.get(cfg.wsUrl);
  if (!p) { p = connectApi(cfg); apis.set(cfg.wsUrl, p); p.catch(() => apis.delete(cfg.wsUrl)); }
  return p;
}

/** The registry's 20-byte call target, from its 5… account in config. */
export const registryTarget = (cfg: Config) => {
  if (!cfg.registry) throw new Error("The registry address is not set in public/config.json.");
  return contractTarget(cfg.registry);
};

/** Read-only calls: a `reviveApi.call` dry run against the registry. The caller is irrelevant for views, so any account works. */
const READ_ORIGIN = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
export function makeCall(cfg: Config): ContractCall {
  return async (data) => {
    const [api, target] = await Promise.all([getApi(cfg), registryTarget(cfg)]);
    const res = await api.call.reviveApi.call(READ_ORIGIN, target, 0, null, null, data);
    if (res.result.isErr) throw new Error("The node rejected the read. Check registry in public/config.json.");
    const out = res.result.asOk;
    if (Number(out.flags?.bits ?? 0) & 1) throw new Error("The registry rejected the read.");
    const hex: string = out.data.toHex();
    if (hex === "0x") throw new Error("No registry contract answered at that address. Check registry in public/config.json.");
    return hex;
  };
}

type Signer = { address: string; name: string; signer?: any; pair?: any; viewOnly?: boolean; unlock?: Unlocker };

async function makeWallet(kind: string, who: Signer, cfg: Config, session: Session): Promise<Wallet> {
  const id = await toAccountId(who.address);
  const prepare = async () => {
    if (who.viewOnly) throw new Error("This is a view-only login (account info file only). Log in with the extension or a keystore file to sign.");
    if (who.pair?.isLocked) { // restored after a refresh: the key is still encrypted, ask for the password once
      if (!who.unlock) throw new Error("This keystore is locked. Log in again with the keystore file and password.");
      await who.unlock((pw) => who.pair.decodePkcs8(pw));
    }
    return getApi(cfg);
  };
  const signAndWait = (api: any, tx: any) => new Promise<string>((resolve, reject) => {
    tx.signAndSend(who.pair ?? who.address, who.pair ? {} : { signer: who.signer }, (res: any) => {
      if (!res.status.isInBlock && !res.status.isFinalized) return;
      if (res.dispatchError || res.events.some(({ event }: any) => api.events.system.ExtrinsicFailed.is(event))) return reject(new Error("Transaction failed on-chain."));
      resolve(tx.hash.toHex());
    }).catch(reject);
  });
  const send = async (to: string, data: string, value?: string) => {
    const api = await prepare();
    // Revive takes value in native units; the contract sees it scaled by NativeToEthRatio.
    const ratio = api.consts.revive?.nativeToEthRatio ? BigInt(api.consts.revive.nativeToEthRatio.toString()) : 10n ** BigInt(Math.max(0, cfg.nativeDecimals - (api.registry.chainDecimals[0] ?? cfg.nativeDecimals)));
    const nativeValue = (BigInt(value ?? "0") / ratio).toString();
    // Dry run to get weight and storage deposit limits (Developer > Runtime calls > reviveApi > call).
    const dry = await api.call.reviveApi.call(who.address, to, nativeValue, null, null, data);
    if (dry.result.isErr) throw new Error("Transaction would revert (dry run failed).");
    const dep = dry.storageDeposit;
    const depositLimit = dep.isCharge ? dep.asCharge.toString() : "0";
    return signAndWait(api, api.tx.revive.call(to, nativeValue, dry.gasRequired, depositLimit, data));
  };
  const activate = async () => {
    const api = await prepare();
    if (!api.tx.revive?.mapAccount) throw new Error("This chain has no revive.mapAccount, so there is nothing to activate.");
    return signAndWait(api, api.tx.revive.mapAccount());
  };
  return { kind, name: who.name, ss58: who.address, id, session, send, activate };
}

/** Can this account receive payouts from a contract? A contract pays a 20-byte address, and the chain turns it back into an account
 *  only if that account has registered itself (revive.mapAccount, "activate"); otherwise the money goes to a placeholder account
 *  nobody holds the key to. Accounts that came from an Ethereum address need nothing. Returns null when the chain cannot say. */
export async function isActivated(cfg: Config, ss58: string): Promise<boolean | null> {
  try {
    const api = await getApi(cfg);
    const { decodeAddress, keccakAsU8a } = await load(() => import("@polkadot/util-crypto"));
    const { u8aToHex } = await load(() => import("@polkadot/util"));
    const pk = decodeAddress(ss58.trim());
    if (pk.slice(20).every((b: number) => b === 0xee)) return true;
    const original = api.query.revive?.originalAccount;
    if (!original) return null;
    return (await original(u8aToHex(keccakAsU8a(pk).slice(12)))).isSome;
  } catch { return null; }
}

/** 1. Browser extension. */
export async function loginExtension(cfg: Config): Promise<Wallet[]> {
  const { web3Enable, web3Accounts, web3FromSource } = await load(() => import("@polkadot/extension-dapp"));
  const exts = await web3Enable(APP);
  if (!exts.length) throw new Error("No Substrate wallet extension found. Install one on a desktop browser (or use Orion on mobile).");
  const accounts = await web3Accounts({ ss58Format: cfg.ss58Format ?? 42 });
  if (!accounts.length) throw new Error("The extension has no accounts, or access was declined.");
  const injector = await web3FromSource(accounts[0].meta.source);
  return Promise.all(accounts.map((a) => makeWallet("extension", { address: a.address, name: a.meta.name ?? "Account", signer: injector.signer }, cfg, { kind: "extension", address: a.address, name: a.meta.name ?? "Account" })));
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const firstOf = (vals: unknown[], type: "string" | "number") => vals.find((v) => typeof v === type && (type === "number" ? Number.isInteger(v) : !!v)) as any;

/** Tells a keystore (has an encrypted "encoded" key) from an account info file (has an address), whatever the exact export shape. */
export function classify(text: string): ParsedFile {
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error("not valid JSON"); }
  for (let i = 0; i < 3; i++) { // unwrap [ {...} ], { accounts: [...] }, { keystore: {...} }, { account: {...} }
    if (Array.isArray(j)) j = j[0];
    else if (isObj(j) && typeof j.encoded !== "string" && Array.isArray(j.accounts)) j = j.accounts[0];
    else if (isObj(j) && typeof j.encoded !== "string" && (isObj(j.keystore) || isObj(j.account))) j = j.keystore ?? j.account;
    else break;
  }
  if (!isObj(j)) throw new Error("not a keystore or account info file");
  if (typeof j.encoded === "string") return { kind: "keystore", keystore: j };
  const m = isObj(j.meta) ? j.meta : {};
  const address = firstOf([j.address, j.ss58Address, j.ss58, j.account, j.accountId, j.account_id, j.publicKey, j.public_key, m.address], "string");
  if (!address) throw new Error("no keystore data and no account address found in it");
  return { kind: "info", info: { address, name: firstOf([j.name, j.accountName, m.name], "string"), ss58Format: firstOf([j.ss58Format, j.ss58Prefix, j.prefix, m.ss58Format], "number") } };
}

async function newKeyring(ss58Format: number) {
  const { Keyring } = await load(() => import("@polkadot/keyring"));
  const { cryptoWaitReady } = await load(() => import("@polkadot/util-crypto"));
  await cryptoWaitReady();
  return new Keyring({ type: "sr25519", ss58Format });
}

/** SS58 in the keyring's prefix; a 0x 32-byte public key is encoded. */
async function normAddress(keyring: any, raw: string): Promise<string> {
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error("The account info file has an EVM-style address. This app uses Substrate (5…) addresses only.");
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) { const { hexToU8a } = await load(() => import("@polkadot/util")); return keyring.encodeAddress(hexToU8a(raw)); }
  try { return keyring.encodeAddress(keyring.decodeAddress(raw)); } catch { throw new Error("The address in the account info file is not valid."); }
}

/** 2 + 3. Any combination works: keystore JSON (needs the password), account info JSON (view-only), or both. */
export async function loginFiles(cfg: Config, files: { name: string; text: string }[], password: string): Promise<Wallet> {
  let keystore: any, info: AccountInfo | undefined;
  for (const f of files) {
    let p: ParsedFile;
    try { p = classify(f.text); } catch (e) { throw new Error(`${f.name}: ${(e as Error).message}.`); }
    if (p.kind === "keystore") keystore = p.keystore; else info = p.info;
  }
  if (!keystore && !info) throw new Error("Select a keystore or account info JSON file.");
  const ss58Format = info?.ss58Format ?? cfg.ss58Format ?? 42;
  const keyring = await newKeyring(ss58Format);
  const address = info?.address ? await normAddress(keyring, info.address) : undefined;
  if (!keystore) {
    if (!address) throw new Error("That file has no keystore and no address, so there is nothing to log in with.");
    const name = info?.name ?? "Account";
    return makeWallet("info", { address, name, viewOnly: true }, cfg, { kind: "info", address, name, ss58Format });
  }
  if (!password) throw new Error("Enter the keystore password.");
  let pair: any;
  try { pair = keyring.createFromJson(keystore); } catch { throw new Error("That keystore file could not be read."); }
  try { pair.decodePkcs8(password); } catch { throw new Error("Wrong password for this keystore."); }
  if (address) {
    const { u8aToHex } = await load(() => import("@polkadot/util"));
    const same = u8aToHex(keyring.decodeAddress(address)) === u8aToHex(pair.publicKey);
    if (!same) throw new Error("The account info file does not match this keystore.");
  }
  const name = info?.name ?? keystore.meta?.name ?? "Keystore account";
  const kind: LoginKind = info ? "both" : "keystore";
  return makeWallet(kind, { address: pair.address, name, pair }, cfg, { kind, address: pair.address, name, ss58Format, keystore });
}

/** Rebuild a login after a refresh. A keystore comes back locked: the account shows at once, the password is asked when signing. */
export async function restoreSession(cfg: Config, s: Session, unlock: Unlocker): Promise<Wallet | null> {
  try {
    if (s.kind === "extension") return await reconnectExtension(cfg, s.address);
    const keyring = await newKeyring(s.ss58Format ?? cfg.ss58Format ?? 42);
    if (s.keystore) {
      const pair = keyring.createFromJson(s.keystore);
      return await makeWallet(s.kind, { address: pair.address, name: s.name, pair, unlock }, cfg, s);
    }
    return await makeWallet("info", { address: s.address, name: s.name, viewOnly: true }, cfg, s);
  } catch { return null; }
}

/** Re-attach a previously chosen extension account without any prompt (returns null if not possible). */
export async function reconnectExtension(cfg: Config, ss58: string): Promise<Wallet | null> {
  try { return (await loginExtension(cfg)).find((w) => w.ss58 === ss58) ?? null; } catch { return null; }
}
