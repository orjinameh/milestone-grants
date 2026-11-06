// Contract call descriptors for MilestoneGrants.
import { encodeCall, type AbiType } from "./abi";
// Accounts cross the contract boundary as 32-byte AccountId32 values (the public key behind a 5… address).
const CP: AbiType = { tuple: ["bytes32", "bytes32", "bytes32", "uint", "uint", "string", "bytes32[]", "uint[]"] };
export const SIG = {
  createGrant: "createGrant((bytes32,bytes32,bytes32,uint64,uint8,string,bytes32[],uint128[]))",
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
  hasVoted: "hasVoted(uint256,uint256,bytes32)",
};
export const calls = {
  createGrant: (p: { funder: string; token: string; recipient: string; deadline: number; threshold: number; repo: string; reviewers: string[]; amounts: string[] }) =>
    encodeCall(SIG.createGrant, [CP], [[p.funder, p.token, p.recipient, p.deadline, p.threshold, p.repo, p.reviewers, p.amounts]]),
  claim: (id: number, i: number, commit: string, evidence: string) => encodeCall(SIG.claimMilestone, ["uint", "uint", "bytes20", "string"], [id, i, commit, evidence]),
  approve: (id: number, i: number) => encodeCall(SIG.approveMilestone, ["uint", "uint"], [id, i]),
  reclaim: (id: number) => encodeCall(SIG.reclaim, ["uint"], [id]),
  grantCount: () => encodeCall(SIG.grantCount, [], []),
  grantInfo: (id: number) => encodeCall(SIG.grantInfo, ["uint"], [id]),
  milestoneInfo: (id: number, i: number) => encodeCall(SIG.milestoneInfo, ["uint", "uint"], [id, i]),
  reviewerAt: (id: number, i: number) => encodeCall(SIG.reviewerAt, ["uint", "uint"], [id, i]),
  repoOf: (id: number) => encodeCall(SIG.repoOf, ["uint"], [id]),
  evidenceOf: (id: number, i: number) => encodeCall(SIG.evidenceOf, ["uint", "uint"], [id, i]),
  hasVoted: (id: number, i: number, who: string) => encodeCall(SIG.hasVoted, ["uint", "uint", "bytes32"], [id, i, who]),
  erc20Approve: (spender: string, amount: string) => encodeCall(SIG.erc20Approve, ["address", "uint"], [spender, amount]),
};
