// The real app (/) must never contain or import demo code. Only app/demo/ and demo/ may.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? (n === "demo" || n === "node_modules" ? [] : walk(p)) : /\.(tsx?|json|css)$/.test(n) ? [p] : [];
});

test("nothing outside demo/ and app/demo/ mentions demo mode", () => {
  const offenders = ["app", "components", "lib", "public"].flatMap(walk).filter((f) => {
    const src = readFileSync(f, "utf8");
    return /from\s+["'][^"']*\bdemo\b[^"']*["']/i.test(src) || /\bcfg\.demo\b|DEMO_|["']demo["']|demoWallet|initDemo/.test(src);
  });
  assert.deepEqual(offenders, []);
});

test("the real page and the shared screen do not import the demo", () => {
  for (const f of ["app/page.tsx", "components/GrantsApp.tsx", "components/LoginDialog.tsx", "components/NewGrant.tsx"]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /demo/i, f);
  }
});

test("the demo has its own session key, apart from the real login", () => {
  const demo = readFileSync("demo/mode.tsx", "utf8"), real = readFileSync("app/page.tsx", "utf8");
  assert.match(demo, /sessionKey: "mg-demo-session"/);
  assert.match(real, /SESSION_KEY = "mg-evm-session"/);
});
