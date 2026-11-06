"use client";

import {
  JsonRpcProvider,
  getAddress,
  isAddress as ethersIsAddress,
} from "ethers";
import type { Config, ContractCall } from "./chain";
import { createEVMClient } from "@metamask/connect-evm";

export interface Session {
  kind: string;
  address: string;
  name: string;
}

export type Unlocker = (attempt: (password: string) => void) => Promise<void>;

export interface Wallet {
  kind: string;
  name: string;
  ss58: string;
  id: string;
  session: Session;
  send(to: string, data: string, value?: string): Promise<string>;
  activate?: () => Promise<string>;
}

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<any>;
  providers?: Eip1193[];
  isMetaMask?: boolean;
};

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

let sdkInstance: Awaited<ReturnType<typeof createEVMClient>> | null = null;

const CHAIN_ID = 420420777;
const CHAIN_HEX = "0x190f1ca9";

async function getMetaMask(): Promise<Eip1193> {
  if (typeof window === "undefined") {
    throw new Error("Wallet connection requires a browser.");
  }

  const providers = window.ethereum?.providers ??
    (window.ethereum ? [window.ethereum] : []);
  const injected = providers.find((p) => p.isMetaMask);

  if (injected) return injected;

  if (!sdkInstance) {
    sdkInstance = await createEVMClient({
      dapp: {
        name: "Milestone Grants",
        url: window.location.origin,
      },
      api: {
        supportedNetworks: {
          "0x190f1ca9": "https://test-evm-rpc-v3.portaldot.dev",
          "0x7a69": "https://zany-space-train-v6v5xjjw9xqcx677-8545.app.github.dev/",
        },
      },
    });
  }

  return sdkInstance.getProvider() as unknown as Eip1193;
}

function rpc(cfg: Config) {
  if (!cfg.rpcUrl) throw new Error("Portaldot EVM RPC URL is missing from public/config.json.");
  return cfg.rpcUrl;
}

async function ensureNetwork(provider: Eip1193, cfg: Config) {
  const expected = `0x${(cfg.chainId ?? CHAIN_ID).toString(16)}`;
  const current = await provider.request({ method: "eth_chainId" });

  if (String(current).toLowerCase() === expected.toLowerCase()) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: expected }],
    });
  } catch (error: any) {
    if (error?.code !== 4902) throw error;

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: expected,
        chainName: "Portaldot V3 Testnet",
        nativeCurrency: {
          name: cfg.nativeSymbol || "POT",
          symbol: cfg.nativeSymbol || "POT",
          decimals: cfg.nativeDecimals ?? 18,
        },
        rpcUrls: [rpc(cfg)],
      }],
    });

    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: expected }],
    });
  }

  const verified = await provider.request({ method: "eth_chainId" });
  if (String(verified).toLowerCase() !== expected.toLowerCase()) {
    throw new Error("MetaMask did not switch to Portaldot V3.");
  }
}

/**
 * EVM identity encoding used by MilestoneGrants:
 * 20-byte address followed by twelve 0xEE bytes.
 */
export async function toAccountId(address: string): Promise<string> {
  if (!ethersIsAddress(address)) {
    throw new Error(`"${address}" is not a valid EVM address.`);
  }
  return getAddress(address).toLowerCase() + "ee".repeat(12);
}

export async function fromAccountId(id: string, _ss58Format?: number): Promise<string> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) {
    throw new Error("Invalid bytes32 account ID.");
  }

  const body = id.slice(2);
  if (!body.slice(40).toLowerCase().split("").every((c) => c === "e")) {
    throw new Error("This account ID is not an EVM address.");
  }

  return getAddress("0x" + body.slice(0, 40));
}

export async function contractTarget(address: string): Promise<string> {
  if (!ethersIsAddress(address)) {
    throw new Error(`"${address}" is not a valid EVM contract address.`);
  }
  return getAddress(address);
}

export async function registryTarget(cfg: Config): Promise<string> {
  if (!cfg.registry) {
    throw new Error("The registry address is not set in public/config.json.");
  }
  return contractTarget(cfg.registry);
}

export function makeCall(cfg: Config): ContractCall {
  const provider = new JsonRpcProvider(rpc(cfg), cfg.chainId ?? CHAIN_ID);

  return async (data: string) => {
    const target = await registryTarget(cfg);
    const result = await provider.call({ to: target, data });

    if (!result || result === "0x") {
      throw new Error("No registry contract answered. Check the registry address and deployment.");
    }

    return result;
  };
}

async function createWallet(
  cfg: Config,
  address: string,
  provider: Eip1193,
): Promise<Wallet> {
  const normalized = getAddress(address);
  const id = await toAccountId(normalized);

  const send = async (to: string, data: string, value = "0"): Promise<string> => {
    await ensureNetwork(provider, cfg);

    const accounts = await provider.request({ method: "eth_accounts" });
    const active = accounts?.[0];

    if (!active || active.toLowerCase() !== normalized.toLowerCase()) {
      throw new Error("Your selected MetaMask account changed. Reconnect your wallet.");
    }

    const target = getAddress(to);

    const txHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        from: normalized,
        to: target,
        data,
        value: `0x${BigInt(value).toString(16)}`,
      }],
    });

    if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new Error("Wallet returned an invalid transaction hash.");
    }

    let receipt: any = null;

    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const response = await fetch(rpc(cfg), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getTransactionReceipt",
            params: [txHash],
            id: 1,
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);

        const result = await response.json();
        if (result.error) throw new Error(result.error.message || "RPC receipt error");

        receipt = result.result;
        if (receipt) break;
      } catch (error) {
        if (attempt === 29) throw error;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (!receipt) {
      throw new Error(`Transaction ${txHash} was submitted, but its receipt could not be retrieved. Check the transaction before retrying.`);
    }

    if (receipt.status !== "0x1") {
      throw new Error("The transaction was mined but failed on the network.");
    }

    return txHash;
  };

  const session: Session = {
    kind: "metamask",
    address: normalized,
    name: "MetaMask",
  };

  return {
    kind: "metamask",
    name: "MetaMask",
    ss58: normalized,
    id,
    session,
    send,
  };
}

export async function loginMetaMask(cfg: Config): Promise<Wallet> {
  const provider = await getMetaMask();

  // eth_requestAccounts answers instantly when this site is already permitted in MetaMask. That looks like an
  // automatic login after logout and never lets the user pick a different account. wallet_requestPermissions
  // always opens MetaMask's account picker, so every login is a deliberate choice.
  try {
    await provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  } catch (e: any) {
    if (e?.code === 4001) throw new Error("The wallet connection was declined.");
    if (e?.code === -32002) throw new Error("MetaMask already has a connection request open. Click the MetaMask icon, finish or reject it, then try again.");
    console.warn("wallet_requestPermissions failed:", e);
    // Provider without wallet_requestPermissions (some mobile wallets): fall back to eth_requestAccounts below.
  }

  const accounts = await provider.request({
    method: "eth_requestAccounts",
  });

  if (!accounts?.length) {
    throw new Error("No MetaMask account was shared with this website.");
  }

  await ensureNetwork(provider, cfg);
  return createWallet(cfg, accounts[0], provider);
}

export async function restoreSession(
  cfg: Config,
  session: Session | null,
  _unlock: Unlocker,
): Promise<Wallet | null> {
  if (!session || session.kind !== "metamask") return null;

  try {
    const provider = await getMetaMask();
    const accounts = await provider.request({ method: "eth_accounts" });

    const address = accounts?.find(
      (a: string) => a.toLowerCase() === session.address.toLowerCase(),
    );

    if (!address) return null;

    return await createWallet(cfg, address, provider);
  } catch {
    return null;
  }
}

export async function isActivated(
  _cfg: Config,
  address: string,
): Promise<boolean | null> {
  return ethersIsAddress(address) ? true : false;
}

/**
 * Logout: take this site's account access away in MetaMask, so nothing can silently reconnect.
 * Uses only an already-injected MetaMask (never opens the mobile SDK). If the wallet does not support revoking,
 * the site stays permitted there until the user disconnects it in MetaMask's connected-sites settings.
 */
export async function revokeWalletAccess(): Promise<void> {
  try {
    const w: any = typeof window === "undefined" ? undefined : (window as any);
    const providers: any[] = w?.ethereum?.providers ?? (w?.ethereum ? [w.ethereum] : []);
    const injected = providers.find((p) => p.isMetaMask);
    if (injected) await injected.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch { /* not supported or already revoked */ }
}
