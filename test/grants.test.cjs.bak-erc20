// npx hardhat test   (needs `npm install`)
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const COMMIT = "0x" + "ab".repeat(20);
// Accounts are 32-byte AccountId32 values. A test signer's address becomes an id the way pallet-revive does it for
// Ethereum-derived accounts: the 20 address bytes followed by twelve 0xEE bytes.
const id = (addr) => ethers.concat([addr, "0x" + "ee".repeat(12)]);

describe("MilestoneGrants", () => {
  let g, funder, recipient, r1, r2, r3, other, p;
  const eth = (n) => ethers.parseEther(String(n));
  beforeEach(async () => {
    [funder, recipient, r1, r2, r3, other] = await ethers.getSigners();
    g = await (await ethers.getContractFactory("MilestoneGrants")).deploy();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    p = { funder: id(funder.address), token: ethers.ZeroHash, recipient: id(recipient.address), deadline: now + 86400, threshold: 2, repo: "o/r",
      reviewers: [r1, r2, r3].map((s) => id(s.address)), amounts: [eth(1), eth(2)] };
  });
  const create = () => g.connect(funder).createGrant(p, { value: eth(3) });

  it("creates, claims in order, releases at threshold", async () => {
    await create();
    expect((await g.grantInfo(0)).total).to.equal(eth(3));
    expect((await g.grantInfo(0)).funder).to.equal(id(funder.address));
    expect(await g.reviewerAt(0, 1)).to.equal(id(r2.address));
    await expect(g.connect(recipient).claimMilestone(0, 1, COMMIT, "x")).to.be.revertedWithCustomError(g, "OutOfOrder");
    await g.connect(recipient).claimMilestone(0, 0, COMMIT, "https://pr");
    await g.connect(r1).approveMilestone(0, 0);
    expect(await g.hasVoted(0, 0, id(r1.address))).to.equal(true);
    expect(await g.hasVoted(0, 0, id(r2.address))).to.equal(false);
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
    await expect(g.createGrant({ ...p, reviewers: [id(r1.address), id(r1.address), id(r2.address)] }, { value: eth(3) })).to.be.revertedWithCustomError(g, "BadParams");
    await expect(g.createGrant({ ...p, amounts: [0n] }, { value: 0 })).to.be.revertedWithCustomError(g, "BadParams");
  });
  it("the funder id must belong to the caller", async () => {
    await expect(g.connect(other).createGrant(p, { value: eth(3) })).to.be.revertedWithCustomError(g, "BadParams");
    await expect(g.createGrant({ ...p, funder: id(other.address) }, { value: eth(3) })).to.be.revertedWithCustomError(g, "BadParams");
  });
  it("ordinary 5… accounts (not Ethereum-derived) map by keccak256 and stay readable as ids", async () => {
    const acct = (n) => { const a = ethers.hexlify(ethers.randomBytes(32)); return { id: a, addr: ethers.getAddress("0x" + ethers.keccak256(a).slice(-40)) }; };
    const f = acct(), rc = acct();
    for (const x of [f, rc]) {
      await network.provider.send("hardhat_setBalance", [x.addr, "0x" + (10n ** 20n).toString(16)]);
      await network.provider.send("hardhat_impersonateAccount", [x.addr]);
    }
    const fs = await ethers.getSigner(f.addr), rs = await ethers.getSigner(rc.addr);
    await g.connect(fs).createGrant({ ...p, funder: f.id, recipient: rc.id, threshold: 1 }, { value: eth(3) });
    const info = await g.grantInfo(0);
    expect(info.funder).to.equal(f.id); expect(info.recipient).to.equal(rc.id);
    await g.connect(rs).claimMilestone(0, 0, COMMIT, "");
    await expect(g.connect(r1).approveMilestone(0, 0)).to.changeEtherBalance(rs, eth(1));
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
    await g.createGrant({ ...p, token: id(await T.getAddress()) }); // a contract's account is its address + 0xEE padding
    await g.connect(recipient).claimMilestone(0, 0, COMMIT, "");
    await g.connect(r1).approveMilestone(0, 0); await g.connect(r2).approveMilestone(0, 0);
    expect(await T.balanceOf(recipient.address)).to.equal(eth(1));
  });
});
