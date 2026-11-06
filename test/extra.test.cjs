const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const COMMIT = "0x" + "ab".repeat(20);
const id = (addr) => ethers.concat([addr, "0x" + "ee".repeat(12)]);
const eth = (n) => ethers.parseEther(String(n));
const later = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); };

describe("MilestoneGrants: money-safety edge cases", () => {
  let g, funder, recipient, r1, r2, r3, p;
  beforeEach(async () => {
    [funder, recipient, r1, r2, r3] = await ethers.getSigners();
    g = await (await ethers.getContractFactory("MilestoneGrants")).deploy();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    p = { funder: id(funder.address), token: ethers.ZeroHash, recipient: id(recipient.address), deadline: now + 86400, threshold: 2, repo: "o/r",
      reviewers: [r1, r2, r3].map((s) => id(s.address)), amounts: [eth(1), eth(2)] };
  });

  it("the contract always holds exactly the unreleased funds", async () => {
    await g.createGrant(p, { value: eth(3) });
    const bal = async () => ethers.provider.getBalance(await g.getAddress());
    expect(await bal()).to.equal(eth(3));
    await g.connect(recipient).claimMilestone(0, 0, COMMIT, "");
    await g.connect(r1).approveMilestone(0, 0); await g.connect(r2).approveMilestone(0, 0);
    expect(await bal()).to.equal(eth(2));
    await later(90000);
    await g.connect(funder).reclaim(0);
    expect(await bal()).to.equal(0n);
  });

  it("after reclaim nothing more can be claimed, approved or reclaimed", async () => {
    await g.createGrant(p, { value: eth(3) });
    await g.connect(recipient).claimMilestone(0, 0, COMMIT, "");
    await g.connect(r1).approveMilestone(0, 0);
    await later(90000);
    await g.connect(funder).reclaim(0);
    await expect(g.connect(r2).approveMilestone(0, 0)).to.be.revertedWithCustomError(g, "Closed");
    await expect(g.connect(funder).reclaim(0)).to.be.revertedWithCustomError(g, "Closed");
    await expect(g.connect(recipient).claimMilestone(0, 1, COMMIT, "")).to.be.revertedWithCustomError(g, "Closed");
  });

  it("cannot claim after the deadline, and only the funder can reclaim", async () => {
    await g.createGrant(p, { value: eth(3) });
    await later(90000);
    await expect(g.connect(recipient).claimMilestone(0, 0, COMMIT, "")).to.be.revertedWithCustomError(g, "PastDeadline");
    await expect(g.connect(recipient).reclaim(0)).to.be.revertedWithCustomError(g, "NotFunder");
  });

  it("a claimed milestone can still be approved after the deadline, and the refund excludes what was released", async () => {
    await g.createGrant(p, { value: eth(3) });
    await g.connect(recipient).claimMilestone(0, 0, COMMIT, "");
    await later(90000);
    await g.connect(r1).approveMilestone(0, 0);
    await expect(g.connect(r2).approveMilestone(0, 0)).to.changeEtherBalance(recipient, eth(1));
    await expect(g.connect(funder).reclaim(0)).to.changeEtherBalance(funder, eth(2));
  });

  it("a recipient contract cannot re-enter on payout (approve): payout fails as a whole, nothing is paid twice", async () => {
    const a = await (await ethers.getContractFactory("Attacker")).deploy(await g.getAddress());
    const aid = id(await a.getAddress());
    await g.createGrant({ ...p, recipient: aid }, { value: eth(3) });
    await a.arm(0, 1); await a.claim(0);
    await g.connect(r1).approveMilestone(0, 0);
    await expect(g.connect(r2).approveMilestone(0, 0)).to.be.revertedWithCustomError(g, "TransferFailed");
    expect((await g.milestoneInfo(0, 0)).status).to.equal(1); // still Claimed, funds still in the contract
    expect(await ethers.provider.getBalance(await g.getAddress())).to.equal(eth(3));
  });

  it("a recipient contract cannot reclaim or claim during payout either", async () => {
    for (const mode of [2, 3]) {
      g = await (await ethers.getContractFactory("MilestoneGrants")).deploy();
      const a = await (await ethers.getContractFactory("Attacker")).deploy(await g.getAddress());
      await g.createGrant({ ...p, recipient: id(await a.getAddress()) }, { value: eth(3) });
      await a.arm(0, mode); await a.claim(0);
      await g.connect(r1).approveMilestone(0, 0);
      await expect(g.connect(r2).approveMilestone(0, 0)).to.be.revertedWithCustomError(g, "TransferFailed");
    }
  });

  it("a funder contract cannot re-enter on refund", async () => {
    const a = await (await ethers.getContractFactory("Attacker")).deploy(await g.getAddress());
    const aid = id(await a.getAddress());
    // the attacker is the funder: it must call createGrant itself, so fund it and use a tiny helper call via impersonation
    await network.provider.send("hardhat_setBalance", [await a.getAddress(), "0x" + (10n ** 19n).toString(16)]);
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [await a.getAddress()] });
    const sa = await ethers.getSigner(await a.getAddress());
    await g.connect(sa).createGrant({ ...p, funder: aid }, { value: eth(3) });
    await a.arm(0, 2);
    await later(90000);
    await expect(a.doReclaim()).to.be.revertedWithCustomError(g, "TransferFailed");
    expect((await g.grantInfo(0)).closed).to.equal(false);
  });

  it("the largest grant (10 reviewers, 10 milestones) works", async () => {
    const signers = await ethers.getSigners();
    const revs = signers.slice(5, 15).map((s) => id(s.address));
    const amounts = Array(10).fill(eth(1));
    await g.createGrant({ ...p, reviewers: revs, threshold: 10, amounts }, { value: eth(10) });
    expect((await g.grantInfo(0)).milestoneCount).to.equal(10);
    expect((await g.grantInfo(0)).reviewerCount).to.equal(10);
    await expect(g.createGrant({ ...p, reviewers: [...revs, id(r1.address)], amounts }, { value: eth(10) })).to.be.revertedWithCustomError(g, "BadParams");
  });

  it("rejects a zero commit, an unknown grant and an out-of-range milestone", async () => {
    await g.createGrant(p, { value: eth(3) });
    await expect(g.connect(recipient).claimMilestone(0, 0, "0x" + "00".repeat(20), "")).to.be.revertedWithCustomError(g, "BadParams");
    await expect(g.connect(recipient).claimMilestone(9, 0, COMMIT, "")).to.be.revertedWithCustomError(g, "NoSuchGrant");
    await expect(g.connect(recipient).claimMilestone(0, 5, COMMIT, "")).to.be.revertedWithCustomError(g, "BadParams");
    await expect(g.milestoneInfo(0, 5)).to.be.revertedWithCustomError(g, "BadParams");
  });

  it("direct payments to the contract are refused", async () => {
    await expect(funder.sendTransaction({ to: await g.getAddress(), value: 1n })).to.be.reverted;
  });
});
