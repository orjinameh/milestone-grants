// npx hardhat test   (needs `npm install`)
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const COMMIT = "0x" + "ab".repeat(20);

describe("MilestoneGrants", () => {
  let g, funder, recipient, r1, r2, r3, other, p;
  const eth = (n) => ethers.parseEther(String(n));
  beforeEach(async () => {
    [funder, recipient, r1, r2, r3, other] = await ethers.getSigners();
    g = await (await ethers.getContractFactory("MilestoneGrants")).deploy();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    p = { token: ethers.ZeroAddress, recipient: recipient.address, deadline: now + 86400, threshold: 2, repo: "o/r",
      reviewers: [r1.address, r2.address, r3.address], amounts: [eth(1), eth(2)] };
  });
  const create = () => g.connect(funder).createGrant(p, { value: eth(3) });

  it("creates, claims in order, releases at threshold", async () => {
    await create();
    expect((await g.grantInfo(0)).total).to.equal(eth(3));
    await expect(g.connect(recipient).claimMilestone(0, 1, COMMIT, "x")).to.be.revertedWithCustomError(g, "OutOfOrder");
    await g.connect(recipient).claimMilestone(0, 0, COMMIT, "https://pr");
    await g.connect(r1).approveMilestone(0, 0);
    await expect(g.connect(r1).approveMilestone(0, 0)).to.be.revertedWithCustomError(g, "AlreadyVoted");
    await expect(g.connect(r2).approveMilestone(0, 0)).to.changeEtherBalance(recipient, eth(1));
    expect((await g.milestoneInfo(0, 0)).status).to.equal(2);
    await g.connect(recipient).claimMilestone(0, 1, COMMIT, "");
    await g.connect(r2).approveMilestone(0, 1);
    await expect(g.connect(r3).approveMilestone(0, 1)).to.changeEtherBalance(recipient, eth(2));
    expect((await g.grantInfo(0)).released).to.equal(eth(3));
  });
  it("enforces roles and funding", async () => {
    await expect(g.createGrant(p, { value: eth(1) })).to.be.revertedWithCustomError(g, "BadFunding");
    await create();
    await expect(g.connect(other).claimMilestone(0, 0, COMMIT, "")).to.be.revertedWithCustomError(g, "NotRecipient");
    await g.connect(recipient).claimMilestone(0, 0, COMMIT, "");
    await expect(g.connect(other).approveMilestone(0, 0)).to.be.revertedWithCustomError(g, "NotReviewer");
    await expect(g.connect(recipient).claimMilestone(0, 0, COMMIT, "")).to.be.revertedWithCustomError(g, "BadStatus");
    await expect(g.connect(funder).reclaim(0)).to.be.revertedWithCustomError(g, "BeforeDeadline");
  });
  it("rejects bad params", async () => {
    await expect(g.createGrant({ ...p, threshold: 4 }, { value: eth(3) })).to.be.revertedWithCustomError(g, "BadParams");
    await expect(g.createGrant({ ...p, reviewers: [r1.address, r1.address, r2.address] }, { value: eth(3) })).to.be.revertedWithCustomError(g, "BadParams");
    await expect(g.createGrant({ ...p, amounts: [0n] }, { value: 0 })).to.be.revertedWithCustomError(g, "BadParams");
  });
  it("funder reclaims only unreleased funds after the deadline", async () => {
    await create();
    await g.connect(recipient).claimMilestone(0, 0, COMMIT, "");
    await g.connect(r1).approveMilestone(0, 0); await g.connect(r2).approveMilestone(0, 0);
    await network.provider.send("evm_increaseTime", [90000]); await network.provider.send("evm_mine");
    await expect(g.connect(other).reclaim(0)).to.be.revertedWithCustomError(g, "NotFunder");
    await expect(g.connect(funder).reclaim(0)).to.changeEtherBalance(funder, eth(2));
    await expect(g.connect(recipient).claimMilestone(0, 1, COMMIT, "")).to.be.revertedWithCustomError(g, "Closed");
  });
  it("ERC-20 grants via an ERC-20 mock", async () => {
    const T = await (await ethers.getContractFactory("TestToken")).deploy();
    await T.mint(funder.address, eth(10)); await T.approve(await g.getAddress(), eth(3));
    await g.createGrant({ ...p, token: await T.getAddress() });
    await g.connect(recipient).claimMilestone(0, 0, COMMIT, "");
    await g.connect(r1).approveMilestone(0, 0); await g.connect(r2).approveMilestone(0, 0);
    expect(await T.balanceOf(recipient.address)).to.equal(eth(1));
  });
});
