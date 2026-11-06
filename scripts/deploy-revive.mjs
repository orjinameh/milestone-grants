// Deploys MilestoneGrants to Portaldot V3 as a native PolkaVM contract: a Substrate extrinsic (revive.instantiateWithCode)
// signed by your own 5… account, from your keystore JSON.
//
//   KEYSTORE_FILE=./my-account.json npm run deploy:portaldot      (asks for the password, then for a final yes)
//
// Everything up to the final "y" is read-only and costs nothing: the contract is compiled fresh, checked, and dry-run on the chain.
// Any failure before the final "y" sends nothing. Your keystore never leaves your machine.
import fs from "node:fs";
import readline from "node:readline";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady, decodeAddress, encodeAddress, keccakAsHex, keccakAsU8a } from "@polkadot/util-crypto";
import { hexToU8a, u8aConcat, u8aToHex } from "@polkadot/util";
import { buildPvm } from "./compile-pvm.mjs";

const WS = process.env.PORTALDOT_WS || "wss://test-node-v3.portaldot.dev";
const fail = (m) => { console.error("\n✗ " + m + "\n"); process.exit(1); };
const ok = (m) => console.log("✓ " + m);

function ask(q, hidden = false) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); };
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); res(a.trim()); });
  });
}
const big = (x) => BigInt(x?.toString?.() ?? x);
const fmtTok = (v, dec) => { const s = v.toString().padStart(dec + 1, "0"); return `${s.slice(0, -dec)}.${s.slice(-dec).slice(0, 4)}`; };
/** Turns a dispatch error into words: "revive.BlobTooLarge: ..." instead of a bare hex code. */
function describe(api, err) {
  try {
    if (err.isModule) { const e = api.registry.findMetaError(err.asModule); return `${e.section}.${e.name}: ${e.docs.join(" ").trim()}`; }
  } catch {}
  return err.toString();
}
/** The address pallet-revive's default mapper gives an account: accounts that came from an Ethereum address use their first 20 bytes, all others the last 20 bytes of keccak256(accountId). */
const h160Of = (pk) => (pk.slice(20).every((b) => b === 0xee) ? u8aToHex(pk.slice(0, 20)) : u8aToHex(keccakAsU8a(pk).slice(12)));

async function main() {
  // 1. build the native blob, fresh, so a stale file can never be deployed
  const built = await buildPvm().catch((e) => fail(e.message));
  const code = u8aToHex(built.blob);
  ok(`Compiled with resolc ${built.resolc}: ${built.blob.length} bytes, PolkaVM header present.`);

  // 2. keystore
  const file = process.env.KEYSTORE_FILE;
  if (!file || !fs.existsSync(file)) fail("Set KEYSTORE_FILE to the path of your keystore JSON, e.g. KEYSTORE_FILE=./my-account.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof json.encoded !== "string") fail("That file is not a keystore (it has no \"encoded\" field). Use the encrypted key file, not the account info file.");
  await cryptoWaitReady();
  const pair = new Keyring({ type: "sr25519", ss58Format: 42 }).createFromJson(json);
  const password = process.env.KEYSTORE_PASSWORD ?? (await ask("Keystore password: ", true));
  try { pair.decodePkcs8(password); } catch { fail("Wrong password for this keystore."); }
  ok(`Keystore unlocked. Deploying from ${pair.address}`);

  // 3. chain
  const api = await ApiPromise.create({ provider: new WsProvider(WS) });
  if (!api.tx.revive?.instantiateWithCode) fail("This chain has no revive.instantiateWithCode. Check PORTALDOT_WS points at the Portaldot V3 testnet.");
  const chain = (await api.rpc.system.chain()).toString();
  const dec = api.registry.chainDecimals[0], sym = api.registry.chainTokens[0];
  ok(`Connected to ${chain} (${WS}).`);
  const sizeConsts = Object.entries(api.consts.revive ?? {}).filter(([k]) => /code|blob|size|len/i.test(k)).map(([k, v]) => `${k}=${v.toString()}`);
  if (sizeConsts.length) console.log("  chain limits:", sizeConsts.join(", "));
  const free = big((await api.query.system.account(pair.address)).data.free);
  console.log(`  balance: ${fmtTok(free, dec)} ${sym}`);

  // 4. the account mapping the contract's roles depend on must match the chain's own
  const pk = decodeAddress(pair.address);
  const local = h160Of(pk).toLowerCase();
  if (api.call.reviveApi?.address) {
    const onChain = (await api.call.reviveApi.address(pair.address)).toHex().toLowerCase();
    if (onChain !== local) fail(`Account mapping mismatch. The contract derives ${local} for your account but the chain says ${onChain}. Roles would not match. Do not deploy; tell me this output.`);
    ok("Account mapping matches the chain (the contract and the chain agree who each account is).");
  } else {
    console.log("  (this chain does not expose reviveApi.address; the mapping check was skipped)");
  }

  // 5. dry run: free, and it is the real check that the chain accepts this contract
  const dry = await api.call.reviveApi.instantiate(pair.address, 0, null, null, { Upload: code }, "0x", null);
  if (dry.result.isErr) fail("The chain rejected the contract in the dry run (nothing was sent):\n  " + describe(api, dry.result.asErr));
  const okv = dry.result.asOk;
  if (Number(okv.result?.flags?.bits ?? 0) & 1) fail("The constructor reverted in the dry run (nothing was sent).");
  ok("Dry run accepted by the chain.");
  const w = dry.weightRequired ?? dry.gasRequired;
  const d = dry.maxStorageDeposit ?? dry.storageDeposit;
  const deposit = d == null ? 0n : d.isCharge ? big(d.asCharge) : d.isRefund ? 0n : big(d);
  const weight = { refTime: (big(w.refTime) * 12n / 10n).toString(), proofSize: (big(w.proofSize) * 12n / 10n).toString() };
  const limit = deposit * 12n / 10n + 1_000_000n;
  const predicted = okv.addr?.toHex?.();
  console.log(`  storage deposit (refundable hold): about ${fmtTok(deposit, dec)} ${sym}; limit set to ${fmtTok(limit, dec)} ${sym}`);
  if (free < limit) fail(`Not enough ${sym}. You have ${fmtTok(free, dec)} and the deposit alone can reach ${fmtTok(limit, dec)}. Ask the Portaldot admins for more testnet tokens (give your address starting with 5).`);

  // 6. the only step that spends anything
  console.log(`\nReady. Deploying ${built.blob.length} bytes from ${pair.address}.`);
  if ((process.env.YES ?? (await ask("Deploy now? (y/N) "))).toLowerCase().startsWith("y") === false) { console.log("Cancelled. Nothing was sent."); process.exit(0); }
  const tx = api.tx.revive.instantiateWithCode(0, weight, limit.toString(), code, "0x", null);
  const events = await new Promise((resolve, reject) => {
    tx.signAndSend(pair, (res) => {
      if (res.dispatchError) return reject(new Error(describe(api, res.dispatchError)));
      if (res.status.isInBlock) { console.log("In block", res.status.asInBlock.toHex()); resolve(res.events); }
    }).catch(reject);
  }).catch((e) => fail("Deployment failed: " + e.message));
  const failed = events.find(({ event }) => api.events.system.ExtrinsicFailed.is(event));
  if (failed) fail("Deployment failed on-chain: " + describe(api, failed.event.data[0]));

  // 7. contract address
  let address;
  for (const { event } of events) if (event.section === "revive" && event.method === "Instantiated") address = (event.data.contract ?? event.data[1])?.toHex?.();
  address ??= predicted;
  if (!address) fail("Deployed, but I could not read the contract address from the events. Look for revive.Instantiated in this block on the node console.");
  address = address.toLowerCase();

  // 8. verify on the live chain: grantCount() must answer 0, and the registry 5… address must be the account that answers
  const registry = encodeAddress(u8aConcat(hexToU8a(address), new Uint8Array(12).fill(0xee)), 42);
  await new Promise((r) => setTimeout(r, 4000));
  const sel = keccakAsHex("grantCount()").slice(0, 10);
  const rr = await api.call.reviveApi.call(pair.address, address, 0, null, null, sel).catch((e) => ({ error: e }));
  const verified = rr.result?.isOk && !(Number(rr.result.asOk.flags?.bits ?? 0) & 1) && /^0x0{64}$/.test(rr.result.asOk.data.toHex());
  console.log(verified ? "✓ Verified on-chain: grantCount() returns 0." : `! Could not verify yet (${rr.error?.message ?? "no answer"}). Wait a few blocks and run: npm run check:registry`);

  // 9. wire up the app
  const cfgPath = "public/config.json";
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); cfg.registry = registry;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  console.log("\nContract:", address);
  console.log("Registry (5… address, now in public/config.json):", registry);
  console.log("Next: commit public/config.json and push.");
  await api.disconnect();
  process.exit(0);
}
main().catch((e) => fail(e.stack || e.message));
