// Read-only check of the deployed registry named in public/config.json: it must answer grantCount(). Costs nothing.
//   npm run check:registry
import fs from "node:fs";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { decodeAddress, keccakAsHex } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";

const cfg = JSON.parse(fs.readFileSync("public/config.json", "utf8"));
const fail = (m) => { console.error("\n✗ " + m + "\n"); process.exit(1); };
if (!cfg.registry) fail("No registry set in public/config.json yet.");
const pk = decodeAddress(cfg.registry);
if (!pk.slice(20).every((b) => b === 0xee)) fail("registry is not a contract account (a contract's 5… address ends in twelve 0xEE bytes).");
const api = await ApiPromise.create({ provider: new WsProvider(cfg.wsUrl) });
const r = await api.call.reviveApi.call("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY", u8aToHex(pk.slice(0, 20)), 0, null, null, keccakAsHex("grantCount()").slice(0, 10));
if (r.result.isErr) fail("The chain rejected the call: " + r.result.asErr.toString());
const hex = r.result.asOk.data.toHex();
console.log(hex === "0x" ? "✗ No contract answered at that address." : `✓ Registry answers. grantCount() = ${BigInt(hex)}`);
await api.disconnect();
process.exit(hex === "0x" ? 1 : 0);
