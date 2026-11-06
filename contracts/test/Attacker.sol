// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGrants {
    function approveMilestone(uint256 id, uint256 index) external;
    function reclaim(uint256 id) external;
    function claimMilestone(uint256 id, uint256 index, bytes20 commit, string calldata evidence) external;
}

/// Test only: a recipient / funder contract that tries to re-enter the registry when it is paid.
contract Attacker {
    IGrants public g; uint256 public gid; uint256 public mode; bool public entered;
    constructor(address g_) { g = IGrants(g_); }
    function arm(uint256 id, uint256 m) external { gid = id; mode = m; }
    function claim(uint256 index) external { g.claimMilestone(gid, index, bytes20(uint160(1)), ""); }
    function doReclaim() external { g.reclaim(gid); }
    receive() external payable {
        entered = true;
        if (mode == 1) g.approveMilestone(gid, 0);
        if (mode == 2) g.reclaim(gid);
        if (mode == 3) g.claimMilestone(gid, 1, bytes20(uint160(1)), "");
    }
}
