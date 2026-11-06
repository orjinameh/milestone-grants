// Full-lifecycle tests: payout, rejection, expiry/refund, native + ERC-20, roles, double votes, events.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const C1 = "0x" + "ab".repeat(20), C2 = "0x" + "cd".repeat(20);
const id = (a) => ethers.concat([a, "0x" + "ee".repeat(12)]);
const eth = (n) => ethers.parseEther(String(n));
const later = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); };
const bal = (a) => ethers.provider.getBalance(a);
const events = (g, rc) => rc.logs.map((l) => { try { return g.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
const revert = (p, [c, name]) => expect(p).to.be.revertedWithCustomError(c, name);

describe("MilestoneGrants: lifecycle", () => {
  let g, gAddr, funder, recipient, r1, r2, r3, stranger, base;
  beforeEach(async () => {
    [funder, recipient, r1, r2, r3, stranger] = await ethers.getSigners();
    g = await (await ethers.getContractFactory("MilestoneGrants")).deploy();
    gAddr = await g.getAddress();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    base = { funder: id(funder.address), token: ethers.ZeroHash, recipient: id(recipient.address), deadline: now + 86400, threshold: 2, repo: "o/r",
      reviewers: [r1, r2, r3].map((s) => id(s.address)), amounts: [eth(1), eth(2)] };
  });
  const create = (o = {}, v) => g.createGrant({ ...base, ...o }, { value: v ?? eth(3) });

  it("native: exact payout to the recipient at the threshold, and not before", async () => {
    await create();
    await g.connect(recipient).claimMilestone(0, 0, C1, "https://github.com/o/r/commit/ab");
    const before = await bal(recipient.address);
    await g.connect(r1).approveMilestone(0, 0);
    expect(await bal(recipient.address)).to.equal(before); // 1 of 2: nothing paid
    expect((await g.milestoneInfo(0, 0)).status).to.equal(1n);
    await g.connect(r2).approveMilestone(0, 0);
    expect(await bal(recipient.address)).to.equal(before + eth(1)); // recipient pays no gas here, exact +1
    expect((await g.milestoneInfo(0, 0)).status).to.equal(2n);
    expect((await g.grantInfo(0)).released).to.equal(eth(1));
    expect(await bal(gAddr)).to.equal(eth(2));
  });

  it("insufficient approvals: nothing is released, funder gets everything back after the deadline", async () => {
    await create();
    await g.connect(recipient).claimMilestone(0, 0, C1, "");
    await g.connect(r1).approveMilestone(0, 0); // 1 of 2, never reaches the threshold
    expect((await g.grantInfo(0)).released).to.equal(0n);
    await later(90000);
    const before = await bal(funder.address);
    const rc = await (await g.reclaim(0)).wait();
    expect(await bal(funder.address)).to.equal(before - rc.gasUsed * rc.gasPrice + eth(3));
    expect(await bal(gAddr)).to.equal(0n);
    await revert(g.connect(r2).approveMilestone(0, 0), [g, "Closed"]);
  });

  it("a reviewer cannot vote twice and a non-reviewer cannot vote", async () => {
    await create();
    await g.connect(recipient).claimMilestone(0, 0, C1, "");
    await g.connect(r1).approveMilestone(0, 0);
    await revert(g.connect(r1).approveMilestone(0, 0), [g, "AlreadyVoted"]);
    await revert(g.connect(stranger).approveMilestone(0, 0), [g, "NotReviewer"]);
    await revert(g.connect(funder).approveMilestone(0, 0), [g, "NotReviewer"]);
    await revert(g.connect(recipient).approveMilestone(0, 0), [g, "NotReviewer"]);
    expect(await g.hasVoted(0, 0, id(r1.address))).to.equal(true);
    expect(await g.hasVoted(0, 0, id(r2.address))).to.equal(false);
  });

  it("cannot approve an unclaimed or already released milestone, cannot claim twice", async () => {
    await create();
    await revert(g.connect(r1).approveMilestone(0, 0), [g, "BadStatus"]);
    await g.connect(recipient).claimMilestone(0, 0, C1, "");
    await revert(g.connect(recipient).claimMilestone(0, 0, C2, ""), [g, "BadStatus"]);
    await g.connect(r1).approveMilestone(0, 0); await g.connect(r2).approveMilestone(0, 0);
    await revert(g.connect(r3).approveMilestone(0, 0), [g, "BadStatus"]); // already released: no double pay
    await revert(g.connect(recipient).claimMilestone(0, 0, C2, ""), [g, "BadStatus"]);
    await g.connect(recipient).claimMilestone(0, 1, C2, ""); // next milestone is now claimable
    await revert(g.connect(recipient).claimMilestone(0, 1, C2, ""), [g, "BadStatus"]);
  });

  it("the recorded commit and evidence are exactly what was claimed", async () => {
    await create();
    await g.connect(recipient).claimMilestone(0, 0, C1, "https://x/y");
    expect((await g.milestoneInfo(0, 0)).commit).to.equal(C1);
    expect(await g.evidenceOf(0, 0)).to.equal("https://x/y");
    expect(await g.repoOf(0)).to.equal("o/r");
    expect(await g.reviewerAt(0, 2)).to.equal(id(r3.address));
  });

  it("emits the events the UI parses, with the right arguments", async () => {
    const rc = await (await create()).wait();
    const created = events(g, rc).find((e) => e.name === "GrantCreated");
    expect(created.args.id).to.equal(0n); expect(created.args.total).to.equal(eth(3));
    expect(created.args.funder).to.equal(id(funder.address)); expect(created.args.recipient).to.equal(id(recipient.address));
    const c = events(g, await (await g.connect(recipient).claimMilestone(0, 0, C1, "e")).wait()).find((e) => e.name === "MilestoneClaimed");
    expect(c.args.commit).to.equal(C1);
    await g.connect(r1).approveMilestone(0, 0);
    const ev = events(g, await (await g.connect(r2).approveMilestone(0, 0)).wait());
    expect(ev.map((e) => e.name)).to.deep.equal(["MilestoneApproved", "MilestoneReleased"]);
    expect(ev[0].args.approvals).to.equal(2n); expect(ev[1].args.amount).to.equal(eth(1));
    await later(90000);
    const cl = events(g, await (await g.reclaim(0)).wait()).find((e) => e.name === "GrantClosed");
    expect(cl.args.refunded).to.equal(eth(2));
  });

  it("threshold 1 releases on the first approval; threshold = N needs everyone", async () => {
    await create({ threshold: 1 });
    await g.connect(recipient).claimMilestone(0, 0, C1, "");
    const b = await bal(recipient.address);
    await g.connect(r3).approveMilestone(0, 0);
    expect(await bal(recipient.address)).to.equal(b + eth(1));
    await create({ threshold: 3 });
    await g.connect(recipient).claimMilestone(1, 0, C1, "");
    await g.connect(r1).approveMilestone(1, 0); await g.connect(r2).approveMilestone(1, 0);
    expect((await g.milestoneInfo(1, 0)).status).to.equal(1n);
    await g.connect(r3).approveMilestone(1, 0);
    expect((await g.milestoneInfo(1, 0)).status).to.equal(2n);
  });

  it("a milestone claimed but unapproved at expiry is refunded, then the grant is dead", async () => {
    await create();
    await g.connect(recipient).claimMilestone(0, 0, C1, "");
    await later(90000);
    await revert(g.connect(recipient).claimMilestone(0, 1, C1, ""), [g, "PastDeadline"]);
    const rc = await (await g.reclaim(0)).wait();
    expect(events(g, rc)[0].args.refunded).to.equal(eth(3));
    await revert(g.connect(r1).approveMilestone(0, 0), [g, "Closed"]);
    await revert(g.reclaim(0), [g, "Closed"]);
  });

  it("reclaim is blocked before the deadline and for anyone but the funder", async () => {
    await create();
    await revert(g.reclaim(0), [g, "BeforeDeadline"]);
    await later(90000);
    await revert(g.connect(stranger).reclaim(0), [g, "NotFunder"]);
    await revert(g.connect(recipient).reclaim(0), [g, "NotFunder"]);
  });

  it("account switching: one wallet holds different roles in different grants, never the wrong one", async () => {
    await create(); // grant 0: funder -> recipient
    // the recipient of grant 0 funds grant 1 to a third party; the funder id must be the caller's own
    await revert(g.connect(recipient).createGrant({ ...base, recipient: id(stranger.address) }, { value: eth(3) }), [g, "BadParams"]); // funder id is someone else
    await g.connect(recipient).createGrant({ ...base, funder: id(recipient.address), recipient: id(stranger.address) }, { value: eth(3) });
    expect((await g.grantInfo(1)).funder).to.equal(id(recipient.address));
    // roles are per grant: the recipient of grant 0 cannot reclaim or claim grant 1
    await revert(g.connect(funder).claimMilestone(1, 0, C1, ""), [g, "NotRecipient"]);
    await g.connect(stranger).claimMilestone(1, 0, C1, "");
    await revert(g.connect(recipient).claimMilestone(0, 1, C1, ""), [g, "OutOfOrder"]);
    await later(90000);
    await revert(g.connect(funder).reclaim(1), [g, "NotFunder"]);
    await g.connect(recipient).reclaim(1);
  });

  it("native funding must match exactly", async () => {
    await revert(create({}, eth(2)), [g, "BadFunding"]);
    await revert(create({}, eth(4)), [g, "BadFunding"]);
    await revert(create({}, 0n), [g, "BadFunding"]);
  });

  it("ERC-20: tokens move exactly, payout to the recipient, refund to the funder", async () => {
    const tok = await (await ethers.getContractFactory("PlainToken")).deploy();
    const t = await tok.getAddress();
    await tok.mint(funder.address, eth(10));
    const tp = { token: id(t) };
    await revert(g.createGrant({ ...base, ...tp }), [g, "TransferFailed"]); // no allowance
    await revert(g.createGrant({ ...base, ...tp }, { value: 1n }), [g, "BadFunding"]); // value with a token
    await tok.approve(gAddr, eth(3));
    await g.createGrant({ ...base, ...tp });
    expect(await tok.balanceOf(gAddr)).to.equal(eth(3));
    expect(await tok.balanceOf(funder.address)).to.equal(eth(7));
    await g.connect(recipient).claimMilestone(0, 0, C1, "");
    await g.connect(r1).approveMilestone(0, 0); await g.connect(r2).approveMilestone(0, 0);
    expect(await tok.balanceOf(recipient.address)).to.equal(eth(1));
    await later(90000);
    await g.reclaim(0);
    expect(await tok.balanceOf(funder.address)).to.equal(eth(9));
    expect(await tok.balanceOf(gAddr)).to.equal(0n);
  });

  it("a token id that is not a contract is rejected", async () => {
    await revert(g.createGrant({ ...base, token: id(stranger.address) }), [g, "BadParams"]);
  });
});
