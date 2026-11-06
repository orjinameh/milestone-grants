// Demo mode (served at /demo, never imported by the real app at /): a stand-in for the MilestoneGrants contract that lives in this browser tab, so the whole flow can be shown
// (fund, claim, approve, release, reclaim) with no node, no wallet and no deployment. Nothing leaves the page except the
// GitHub commit lookup, which stays real.
//
// It speaks the same calldata as the real contract: the app encodes every call with lib/api.ts, this file decodes it,
// applies the contract's rules and answers in the contract's return format, so the UI code path is the production one.
import { SIG } from "../lib/api";
import { encodeParams, selectorOf, wId } from "../lib/abi";
import { bytesToBig, bytesToHex, hexToBytes } from "../lib/hex";
import type { ContractCall } from "../lib/chain";
import type { Session, Wallet } from "../lib/wallet";

/** Stands in for the registry's 20-byte target in demo mode. */
export const DEMO_REGISTRY = "0x" + "d0".repeat(20);

export interface DemoAccount { role: string; name: string; ss58: string; id: string }
/** The well-known Substrate development accounts (SS58 prefix 42), so every address is a valid 5… address. */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  { role: "Funder", name: "Alice", ss58: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY", id: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d" },
  { role: "Builder", name: "Bob", ss58: "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty", id: "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48" },
  { role: "Reviewer 1", name: "Charlie", ss58: "5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y", id: "0x90b5ab205c6974c9ea841be688864633dc9ca8a357843eeacf2314649965fe22" },
  { role: "Reviewer 2", name: "Dave", ss58: "5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy", id: "0x306721211d5404bd9da88e0204360a1a9ab8b87c66c1bc2fcdd37f3c2222cc20" },
  { role: "Reviewer 3", name: "Eve", ss58: "5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw", id: "0xe659a7a1628cdd93febc04a4e0646ea20e9f5f0ce097d9a05290d4a9e054df4e" },
];

interface Ms { amount: bigint; status: number; approvals: number; commit: string; evidence: string }
interface G {
  funder: string; token: string; recipient: string; total: bigint; released: bigint; createdAt: number; deadline: number;
  threshold: number; closed: boolean; repo: string; reviewers: string[]; ms: Ms[]; voted: Set<string>;
}
interface DemoState { grants: G[]; repo: string }

const ZERO32 = "0x" + "00".repeat(32);
const ZERO20 = "0x" + "00".repeat(20);
const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);

/** Contract custom errors, in words the person watching can read. */
const WHY: Record<string, string> = {
  BadParams: "The grant details were rejected (check the reviewers, the approvals needed and the deadline).",
  BadFunding: "The amount sent does not match the milestones.",
  NoSuchGrant: "That grant does not exist.",
  NotRecipient: "Only the recipient can claim a milestone.",
  NotReviewer: "Only a reviewer of this grant can approve.",
  NotFunder: "Only the funder can reclaim.",
  Closed: "This grant is closed.",
  PastDeadline: "The deadline has passed.",
  BeforeDeadline: "The deadline has not passed yet.",
  OutOfOrder: "The previous milestone has to be paid first.",
  BadStatus: "That milestone is not in the right state for this.",
  AlreadyVoted: "You already approved this milestone.",
};
const revert = (name: string) => new Error(`Transaction would revert: ${WHY[name] ?? name}`);

// ---- state: survives hot reloads, reset on demand ----
const slot = globalThis as unknown as { __mgDemo?: DemoState };

function seed(repo: string): G[] {
  const now = nowS(), pot = 10n ** 18n;
  const [alice, bob, charlie, dave, eve] = DEMO_ACCOUNTS.map((a) => a.id);
  const make = (amounts: bigint[], createdAt: number, deadline: number): G => ({
    funder: alice, token: ZERO32, recipient: bob, total: amounts.reduce((s, a) => s + a, 0n), released: 0n, createdAt, deadline, threshold: 2,
    closed: false, repo, reviewers: [charlie, dave, eve], voted: new Set(),
    ms: amounts.map((amount) => ({ amount, status: 0, approvals: 0, commit: ZERO20, evidence: "" })),
  });
  return [
    make([1n * pot, 2n * pot], now - 30 * DAY, now - 2 * DAY), // grant 0: deadline passed, nothing claimed: the funder can reclaim
    make([2n * pot, 3n * pot, 5n * pot], now - 40 * DAY, now + 20 * DAY), // grant 1: fresh, ready for the builder to claim milestone 1
  ];
}

export function initDemo(repo: string): void {
  if (!slot.__mgDemo || slot.__mgDemo.repo !== repo) slot.__mgDemo = { grants: seed(repo), repo };
}
export function resetDemo(repo: string): void { slot.__mgDemo = undefined; initDemo(repo); }

const DEMO_FALLBACK_REPO = "paritytech/polkadot-sdk";

// ---- the contract ----
const SEL: Record<string, keyof typeof SIG> = Object.fromEntries(
  (Object.keys(SIG) as (keyof typeof SIG)[]).map((k) => [bytesToHex(selectorOf(SIG[k])), k]),
);
const enc = (types: Parameters<typeof encodeParams>[0], values: unknown[]) => bytesToHex(encodeParams(types, values));
const U11 = ["bytes32", "bytes32", "bytes32", "uint", "uint", "uint", "uint", "uint", "uint", "uint", "uint"] as const;

function readString(a: Uint8Array, at: number): string {
  const len = Number(bytesToBig(a.slice(at, at + 32)));
  return new TextDecoder().decode(a.slice(at + 32, at + 32 + len));
}
function readWords(a: Uint8Array, at: number): Uint8Array[] {
  const n = Number(bytesToBig(a.slice(at, at + 32))), out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) out.push(a.slice(at + 32 + i * 32, at + 64 + i * 32));
  return out;
}

/** Runs one call against the simulated contract. `caller` is null for reads. Returns the ABI-encoded result. */
export function exec(caller: string | null, data: string, value: bigint = 0n, now: number = nowS()): string {
  const grants = (slot.__mgDemo ?? (initDemo(DEMO_FALLBACK_REPO), slot.__mgDemo!)).grants;
  const fn = SEL[data.slice(0, 10).toLowerCase()];
  const a = hexToBytes("0x" + data.slice(10));
  const w = (i: number) => a.slice(i * 32, i * 32 + 32);
  const n = (i: number) => bytesToBig(w(i));
  const grantAt = (id: bigint) => { if (id >= BigInt(grants.length)) throw revert("NoSuchGrant"); return grants[Number(id)]; };
  const need = () => { if (!caller) throw new Error("Log in first."); return caller; };

  switch (fn) {
    case "grantCount": return enc(["uint"], [grants.length]);
    case "grantInfo": {
      const g = grantAt(n(0));
      return enc([...U11], [g.funder, g.token, g.recipient, g.total, g.released, g.createdAt, g.deadline, g.threshold, g.closed ? 1 : 0, g.reviewers.length, g.ms.length]);
    }
    case "milestoneInfo": {
      const g = grantAt(n(0)); if (n(1) >= BigInt(g.ms.length)) throw revert("BadParams");
      const m = g.ms[Number(n(1))];
      return enc(["uint", "uint", "uint", "bytes20"], [m.amount, m.status, m.approvals, m.commit]);
    }
    case "reviewerAt": {
      const g = grantAt(n(0)); if (n(1) >= BigInt(g.reviewers.length)) throw revert("BadParams");
      return enc(["bytes32"], [g.reviewers[Number(n(1))]]);
    }
    case "hasVoted": { const g = grantAt(n(0)); return enc(["uint"], [g.voted.has(`${n(1)}:${wId(w(2))}`) ? 1 : 0]); }
    case "repoOf": return enc(["string"], [grantAt(n(0)).repo]);
    case "evidenceOf": {
      const g = grantAt(n(0)); if (n(1) >= BigInt(g.ms.length)) throw revert("BadParams");
      return enc(["string"], [g.ms[Number(n(1))].evidence]);
    }

    case "createGrant": {
      const me = need(), t = Number(n(0)), tw = (i: number) => a.slice(t + i * 32, t + i * 32 + 32);
      const funder = wId(tw(0)), token = wId(tw(1)), recipient = wId(tw(2));
      const deadline = Number(bytesToBig(tw(3))), threshold = Number(bytesToBig(tw(4)));
      const repo = readString(a, t + Number(bytesToBig(tw(5))));
      const reviewers = readWords(a, t + Number(bytesToBig(tw(6)))).map(wId);
      const amounts = readWords(a, t + Number(bytesToBig(tw(7)))).map(bytesToBig);
      if (recipient === ZERO32 || funder !== me) throw revert("BadParams");
      if (!reviewers.length || reviewers.length > 10 || threshold === 0 || threshold > reviewers.length) throw revert("BadParams");
      if (!amounts.length || amounts.length > 10 || deadline <= now) throw revert("BadParams");
      if (reviewers.some((r, i) => r === ZERO32 || reviewers.indexOf(r) !== i) || amounts.some((x) => x === 0n)) throw revert("BadParams");
      if (token !== ZERO32) throw new Error("Paying in a token is not available in demo mode.");
      const total = amounts.reduce((s, x) => s + x, 0n);
      if (value !== total) throw revert("BadFunding");
      grants.push({ funder, token, recipient, total, released: 0n, createdAt: now, deadline, threshold, closed: false, repo, reviewers, voted: new Set(),
        ms: amounts.map((amount) => ({ amount, status: 0, approvals: 0, commit: ZERO20, evidence: "" })) });
      return enc(["uint"], [grants.length - 1]);
    }
    case "claimMilestone": {
      const me = need(), g = grantAt(n(0)), i = n(1);
      if (me !== g.recipient) throw revert("NotRecipient");
      if (g.closed) throw revert("Closed");
      if (now > g.deadline) throw revert("PastDeadline");
      if (i >= BigInt(g.ms.length)) throw revert("BadParams");
      const k = Number(i);
      if (k > 0 && g.ms[k - 1].status !== 2) throw revert("OutOfOrder");
      if (g.ms[k].status !== 0) throw revert("BadStatus");
      const commit = bytesToHex(w(2).slice(0, 20));
      if (commit === ZERO20) throw revert("BadParams");
      Object.assign(g.ms[k], { status: 1, commit, evidence: readString(a, Number(n(3))) });
      return "0x";
    }
    case "approveMilestone": {
      const me = need(), g = grantAt(n(0)), i = n(1);
      if (g.closed) throw revert("Closed");
      if (!g.reviewers.includes(me)) throw revert("NotReviewer");
      if (i >= BigInt(g.ms.length)) throw revert("BadParams");
      const k = Number(i), m = g.ms[k], key = `${i}:${me}`;
      if (m.status !== 1) throw revert("BadStatus");
      if (g.voted.has(key)) throw revert("AlreadyVoted");
      g.voted.add(key); m.approvals += 1;
      if (m.approvals >= g.threshold) { m.status = 2; g.released += m.amount; }
      return "0x";
    }
    case "reclaim": {
      const me = need(), g = grantAt(n(0));
      if (me !== g.funder) throw revert("NotFunder");
      if (g.closed) throw revert("Closed");
      if (now <= g.deadline) throw revert("BeforeDeadline");
      g.closed = true;
      return "0x";
    }
    default: throw new Error("Unknown call in demo mode.");
  }
}

/** Read access for readGrant & co. */
export const demoCall: ContractCall = async (data) => exec(null, data);

// ---- accounts ----
export function demoWallet(acc: DemoAccount): Wallet {
  return {
    kind: "demo", name: acc.name, ss58: acc.ss58, id: acc.id, session: { kind: "demo", address: acc.ss58, name: acc.name },
    send: async (to, data, value) => {
      if (to.toLowerCase() !== DEMO_REGISTRY) throw new Error("Paying in a token is not available in demo mode.");
      await new Promise((r) => setTimeout(r, 700)); // about one block, so the "signing" toast is visible while recording
      exec(acc.id, data, BigInt(value ?? "0"));
      return "0x" + "00".repeat(32);
    },
  };
}
export const restoreDemo = (s: Session): Wallet | null => {
  const acc = DEMO_ACCOUNTS.find((a) => a.ss58 === s.address);
  return acc ? demoWallet(acc) : null;
};
export const roleOf = (ss58: string) => DEMO_ACCOUNTS.find((a) => a.ss58 === ss58);
