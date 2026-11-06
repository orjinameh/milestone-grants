"use client";

import {
  BrowserProvider,
  JsonRpcProvider,
  getAddress,
  isAddress as ethersIsAddress,
} from "ethers";
import type { Config, ContractCall } from "./chain";

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

const CHAIN_ID = 420420777;
const CHAIN_HEX = "0x190f1ca9";

function getMetaMask(): Eip1193 {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask was not detected. Open Milestone Grants inside the MetaMask mobile browser.");
  }

  const providers = window.ethereum.providers ?? [window.ethereum];
  const metaMask = providers.find((p) => p.isMetaMask);

  if (!metaMask) {
    throw new Error("MetaMask provider not found. Open this website in MetaMask's browser.");
  }

  return metaMask;
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

    const browserProvider = new BrowserProvider(provider as any, "any");
    const signer = await browserProvider.getSigner(normalized);
    const target = getAddress(to);

    const tx = await signer.sendTransaction({
      to: target,
      data,
      value: BigInt(value),
    });

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error("The transaction failed on Portaldot.");
    }

    return tx.hash;
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
  const provider = getMetaMask();

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
    const provider = getMetaMask();
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
