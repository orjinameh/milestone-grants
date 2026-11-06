// The demo contract, driven through the app's own encoders and readers (lib/api.ts, lib/chain.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { calls } from "../lib/api";
import { readGrant, readGrantCount } from "../lib/chain";
import { DEMO_ACCOUNTS, demoCall, exec, initDemo, resetDemo } from "../demo/contract";

const [alice, bob, charlie, dave, eve] = DEMO_ACCOUNTS.map((a) => a.id);
const POT = 10n ** 18n, COMMIT = "0x" + "ab".repeat(20), ZERO = "0x" + "00".repeat(32);
const fresh = () => resetDemo("o/r");
const send = (who: string, data: string, value = 0n) => exec(who, data, value);
const view = (id: number, viewer?: string) => readGrant(demoCall, id, viewer);

test("seed: an expired grant and an active one, read through the real decoder", async () => {
  fresh();
  assert.equal(await readGrantCount(demoCall), 2);
  const g = await view(1, charlie);
  assert.equal(g.repo, "o/r"); assert.equal(g.funder, alice); assert.equal(g.recipient, bob);
  assert.deepEqual(g.reviewers, [charlie, dave, eve]);
  assert.equal(g.total, 10n * POT); assert.equal(g.threshold, 2);
  assert.deepEqual(g.milestones.map((m) => m.status), [0, 0, 0]);
  assert.ok(g.deadline > Date.now() / 1000);
  assert.ok((await view(0)).deadline < Date.now() / 1000);
});

test("claim in order, approve to the threshold, funds are released", async () => {
  fresh();
  assert.throws(() => send(bob, calls.claim(1, 1, COMMIT, "")), /previous milestone/);
  assert.throws(() => send(alice, calls.claim(1, 0, COMMIT, "")), /Only the recipient/);
  send(bob, calls.claim(1, 0, COMMIT, "https://github.com/o/r/pull/1"));
  let g = await view(1, charlie);
  assert.equal(g.milestones[0].status, 1); assert.equal(g.milestones[0].commit, COMMIT);
  assert.equal(g.milestones[0].evidence, "https://github.com/o/r/pull/1");
  assert.equal(g.milestones[0].viewerVoted, false);
  assert.throws(() => send(bob, calls.approve(1, 0)), /Only a reviewer/);
  send(charlie, calls.approve(1, 0));
  assert.throws(() => send(charlie, calls.approve(1, 0)), /already approved/);
  g = await view(1, charlie);
  assert.equal(g.milestones[0].approvals, 1); assert.equal(g.milestones[0].viewerVoted, true); assert.equal(g.released, 0n);
  send(dave, calls.approve(1, 0));
  g = await view(1);
  assert.equal(g.milestones[0].status, 2); assert.equal(g.released, 2n * POT);
  send(bob, calls.claim(1, 1, COMMIT, "")); // next one unlocks
  assert.throws(() => send(bob, calls.claim(1, 0, COMMIT, "")), /not in the right state/);
});

test("fund a new grant: exact value, validation, shows up first", async () => {
  fresh();
  const deadline = Math.floor(Date.now() / 1000) + 14 * 86400;
  const base = { funder: alice, token: ZERO, recipient: bob, deadline, threshold: 2, repo: "me/proj", reviewers: [charlie, dave, eve], amounts: [String(POT), String(2n * POT)] };
  assert.throws(() => send(alice, calls.createGrant(base), 1n), /amount sent/);
  assert.throws(() => send(bob, calls.createGrant(base), 3n * POT), /grant details/); // funder id is not the caller
  assert.throws(() => send(alice, calls.createGrant({ ...base, threshold: 4 }), 3n * POT), /grant details/);
  assert.throws(() => send(alice, calls.createGrant({ ...base, reviewers: [charlie, charlie, dave] }), 3n * POT), /grant details/);
  assert.throws(() => send(alice, calls.createGrant({ ...base, deadline: 5 }), 3n * POT), /grant details/);
  send(alice, calls.createGrant(base), 3n * POT);
  assert.equal(await readGrantCount(demoCall), 3);
  const g = await view(2);
  assert.equal(g.repo, "me/proj"); assert.equal(g.total, 3n * POT); assert.deepEqual(g.milestones.map((m) => m.amount), [POT, 2n * POT]);
  assert.ok(Math.abs(g.createdAt - Date.now() / 1000) < 5);
});

test("reclaim only after the deadline, only by the funder, once", async () => {
  fresh();
  assert.throws(() => send(alice, calls.reclaim(1)), /not passed yet/);
  assert.throws(() => send(bob, calls.reclaim(0)), /Only the funder/);
  send(alice, calls.reclaim(0));
  assert.equal((await view(0)).closed, true);
  assert.throws(() => send(alice, calls.reclaim(0)), /closed/);
  assert.throws(() => send(bob, calls.claim(0, 0, COMMIT, "")), /closed/);
});

test("unknown grant, and a read-only caller cannot write", async () => {
  fresh();
  await assert.rejects(() => view(9), /does not exist/);
  assert.throws(() => exec(null, calls.approve(1, 0)), /Log in/);
  initDemo("o/r");
});
