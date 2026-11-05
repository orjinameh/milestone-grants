// Contract call descriptors for MilestoneGrants.
import { encodeCall, type AbiType } from "./abi.js";
const CP: AbiType = { tuple: ["address", "address", "uint", "uint", "string", "address[]", "uint[]"] };
export const SIG = {
  createGrant: "createGrant((address,address,uint64,uint8,string,address[],uint128[]))",
  claimMilestone: "claimMilestone(uint256,uint256,bytes20,string)",
  approveMilestone: "approveMilestone(uint256,uint256)",
  reclaim: "reclaim(uint256)",
  grantCount: "grantCount()",
  grantInfo: "grantInfo(uint256)",
  milestoneInfo: "milestoneInfo(uint256,uint256)",
  reviewerAt: "reviewerAt(uint256,uint256)",
  repoOf: "repoOf(uint256)",
  evidenceOf: "evidenceOf(uint256,uint256)",
  erc20Approve: "approve(address,uint256)",
};
export const calls = {
  createGrant: (p: { token: string; recipient: string; deadline: number; threshold: number; repo: string; reviewers: string[]; amounts: string[] }) =>
    encodeCall(SIG.createGrant, [CP], [[p.token, p.recipient, p.deadline, p.threshold, p.repo, p.reviewers, p.amounts]]),
  claim: (id: number, i: number, commit: string, evidence: string) => encodeCall(SIG.claimMilestone, ["uint", "uint", "bytes20", "string"], [id, i, commit, evidence]),
  approve: (id: number, i: number) => encodeCall(SIG.approveMilestone, ["uint", "uint"], [id, i]),
  reclaim: (id: number) => encodeCall(SIG.reclaim, ["uint"], [id]),
  grantCount: () => encodeCall(SIG.grantCount, [], []),
  grantInfo: (id: number) => encodeCall(SIG.grantInfo, ["uint"], [id]),
  milestoneInfo: (id: number, i: number) => encodeCall(SIG.milestoneInfo, ["uint", "uint"], [id, i]),
  reviewerAt: (id: number, i: number) => encodeCall(SIG.reviewerAt, ["uint", "uint"], [id, i]),
  repoOf: (id: number) => encodeCall(SIG.repoOf, ["uint"], [id]),
  evidenceOf: (id: number, i: number) => encodeCall(SIG.evidenceOf, ["uint", "uint"], [id, i]),
  erc20Approve: (spender: string, amount: string) => encodeCall(SIG.erc20Approve, ["address", "uint"], [spender, amount]),
};
