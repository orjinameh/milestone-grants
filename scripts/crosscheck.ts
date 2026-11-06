// Proves the hand-written ABI encoder matches ethers for every call the UI makes.  Run: npx tsx scripts/crosscheck.ts
import { Interface } from "ethers";
import { calls, SIG } from "../lib/api";
const abi = new Interface([
  "function createGrant((bytes32 funder,bytes32 token,bytes32 recipient,uint64 deadline,uint8 threshold,string repo,bytes32[] reviewers,uint128[] amounts) p) payable returns (uint256)",
  "function claimMilestone(uint256,uint256,bytes20,string)", "function approveMilestone(uint256,uint256)", "function reclaim(uint256)",
  "function grantCount() view returns (uint256)", "function grantInfo(uint256) view returns (tuple(bytes32,bytes32,bytes32,uint128,uint128,uint64,uint64,uint8,bool,uint8,uint8))",
  "function milestoneInfo(uint256,uint256)", "function reviewerAt(uint256,uint256) view returns (bytes32)", "function repoOf(uint256)", "function evidenceOf(uint256,uint256)",
  "function approve(address,uint256)", "function hasVoted(uint256,uint256,bytes32) view returns (bool)",
]);
const A = "0x" + "11".repeat(32), B = "0x" + "22".repeat(32), N = "0x" + "00".repeat(32), C = "0x" + "ab".repeat(20), T = "0x" + "11".repeat(20); // ids are 32 bytes; C is a commit, T a token address for approve()
const cases: [string, string, unknown[]][] = [
  ["createGrant", calls.createGrant({ funder: A, token: N, recipient: B, deadline: 1900000000, threshold: 2, repo: "o/r", reviewers: [A, B, "0x" + "33".repeat(32)], amounts: ["1000000000000000000", "5"] }),
    [{ funder: A, token: N, recipient: B, deadline: 1900000000, threshold: 2, repo: "o/r", reviewers: [A, B, "0x" + "33".repeat(32)], amounts: [10n ** 18n, 5n] }]],
  ["claimMilestone", calls.claim(3, 1, C, "https://x.y/pr/1"), [3, 1, C, "https://x.y/pr/1"]],
  ["approveMilestone", calls.approve(3, 1), [3, 1]], ["reclaim", calls.reclaim(9), [9]], ["grantCount", calls.grantCount(), []],
  ["grantInfo", calls.grantInfo(4), [4]], ["milestoneInfo", calls.milestoneInfo(4, 2), [4, 2]], ["reviewerAt", calls.reviewerAt(4, 1), [4, 1]],
  ["repoOf", calls.repoOf(4), [4]], ["evidenceOf", calls.evidenceOf(4, 0), [4, 0]], ["approve", calls.erc20Approve(T, "123"), [T, 123n]], ["hasVoted", calls.hasVoted(2, 1, B), [2, 1, B]],
];
let bad = 0;
for (const [fn, mine, args] of cases) {
  const ref = abi.encodeFunctionData(fn, args);
  const ok = mine.toLowerCase() === ref.toLowerCase();
  if (!ok) bad++;
  console.log(ok ? "OK  " : "FAIL", fn);
}
void SIG; process.exit(bad ? 1 : 0);
