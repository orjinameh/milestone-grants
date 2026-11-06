// Compiles contracts/MilestoneGrants.sol to a native PolkaVM blob with Parity's resolc (no network, no toolchain to install).
//   npm run compile:pvm        writes build/MilestoneGrants.polkavm and build/MilestoneGrants.abi.json
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { compile, version } from "@parity/resolc";

export async function buildPvm() {
  const source = fs.readFileSync("contracts/MilestoneGrants.sol", "utf8");
  const out = await compile({ "MilestoneGrants.sol": { content: source } }, { optimizer: { settings: { mode: "z" } } });
  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error("Compile failed:\n" + errors.map((e) => e.formattedMessage ?? e.message).join("\n"));
  const c = out.contracts?.["MilestoneGrants.sol"]?.MilestoneGrants;
  const hex = c?.evm?.bytecode?.object;
  if (!hex) throw new Error("resolc produced no code for MilestoneGrants.");
  const blob = Buffer.from(hex.replace(/^0x/, ""), "hex");
  if (blob.subarray(0, 4).toString("latin1") !== "PVM\0") throw new Error("The compiled code is not a PolkaVM blob (missing the PVM header).");
  fs.mkdirSync("build", { recursive: true });
  fs.writeFileSync("build/MilestoneGrants.polkavm", blob);
  fs.writeFileSync("build/MilestoneGrants.abi.json", JSON.stringify(c.abi, null, 2));
  return { blob, abi: c.abi, resolc: version().trim(), warnings: (out.errors ?? []).filter((e) => e.severity !== "error").length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildPvm().then((r) => console.log(`Compiled with resolc ${r.resolc}: ${r.blob.length} bytes -> build/MilestoneGrants.polkavm (${r.warnings} warnings)`))
    .catch((e) => { console.error("\n✗ " + e.message + "\n"); process.exit(1); });
}
