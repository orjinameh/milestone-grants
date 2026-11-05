// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title MilestoneGrants
/// @notice Milestone-based grant escrow. A funder locks native POT or an ERC-20 against ordered milestones.
///         The recipient claims a milestone by anchoring a git commit hash (a 20-byte SHA-1) plus an evidence
///         URL; an M-of-N reviewer panel approves; when the threshold is reached the milestone's funds are
///         released automatically. After the deadline the funder can reclaim anything not yet released.
contract MilestoneGrants {
    enum Status { Pending, Claimed, Released }

    struct Milestone {
        uint128 amount;
        Status status;
        uint8 approvals;
        bytes20 commit;
        string evidence;
    }

    struct Grant {
        address funder;
        address token; // address(0) = native
        address recipient;
        uint128 total;
        uint128 released;
        uint64 createdAt;
        uint64 deadline;
        uint8 threshold;
        bool closed;
        string repo; // "owner/name" on GitHub, used by the UI to verify commits
        address[] reviewers;
        Milestone[] milestones;
    }

    struct CreateParams {
        address token;
        address recipient;
        uint64 deadline;
        uint8 threshold;
        string repo;
        address[] reviewers;
        uint128[] amounts;
    }

    struct GrantInfo {
        address funder;
        address token;
        address recipient;
        uint128 total;
        uint128 released;
        uint64 createdAt;
        uint64 deadline;
        uint8 threshold;
        bool closed;
        uint8 reviewerCount;
        uint8 milestoneCount;
    }

    struct MilestoneInfo {
        uint128 amount;
        uint8 status;
        uint8 approvals;
        bytes20 commit;
    }

    Grant[] private _grants;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public voted;
    uint256 private _lock = 1;

    event GrantCreated(
        uint256 indexed id, address indexed funder, address indexed recipient, address token,
        uint256 total, uint64 deadline, string repo
    );
    event MilestoneClaimed(uint256 indexed id, uint256 indexed index, bytes20 commit, string evidence);
    event MilestoneApproved(uint256 indexed id, uint256 indexed index, address indexed reviewer, uint8 approvals);
    event MilestoneReleased(uint256 indexed id, uint256 indexed index, address indexed recipient, uint256 amount);
    event GrantClosed(uint256 indexed id, uint256 refunded);

    error BadParams();
    error BadFunding();
    error NoSuchGrant();
    error NotRecipient();
    error NotReviewer();
    error NotFunder();
    error Closed();
    error PastDeadline();
    error BeforeDeadline();
    error OutOfOrder();
    error BadStatus();
    error AlreadyVoted();
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    function createGrant(CreateParams calldata p) external payable nonReentrant returns (uint256 id) {
        uint256 nr = p.reviewers.length;
        uint256 nm = p.amounts.length;
        if (p.recipient == address(0)) revert BadParams();
        if (nr == 0 || nr > 10 || p.threshold == 0 || p.threshold > nr) revert BadParams();
        if (nm == 0 || nm > 10) revert BadParams();
        if (p.deadline <= block.timestamp) revert BadParams();

        for (uint256 i = 0; i < nr; i++) {
            if (p.reviewers[i] == address(0)) revert BadParams();
            for (uint256 j = i + 1; j < nr; j++) {
                if (p.reviewers[i] == p.reviewers[j]) revert BadParams();
            }
        }
        uint256 total;
        for (uint256 i = 0; i < nm; i++) {
            if (p.amounts[i] == 0) revert BadParams();
            total += p.amounts[i];
        }
        if (total > type(uint128).max) revert BadParams();

        if (p.token == address(0)) {
            if (msg.value != total) revert BadFunding();
        } else {
            if (msg.value != 0) revert BadFunding();
            _pull(p.token, msg.sender, total);
        }

        id = _grants.length;
        Grant storage g = _grants.push();
        g.funder = msg.sender;
        g.token = p.token;
        g.recipient = p.recipient;
        g.total = uint128(total);
        g.createdAt = uint64(block.timestamp);
        g.deadline = p.deadline;
        g.threshold = p.threshold;
        g.repo = p.repo;
        for (uint256 i = 0; i < nr; i++) g.reviewers.push(p.reviewers[i]);
        for (uint256 i = 0; i < nm; i++) {
            Milestone storage m = g.milestones.push();
            m.amount = p.amounts[i];
        }
        emit GrantCreated(id, msg.sender, p.recipient, p.token, total, p.deadline, p.repo);
    }

    /// @notice Recipient claims the next milestone by anchoring the git commit that delivers it.
    function claimMilestone(uint256 id, uint256 index, bytes20 commit, string calldata evidence)
        external
        nonReentrant
    {
        Grant storage g = _grant(id);
        if (msg.sender != g.recipient) revert NotRecipient();
        if (g.closed) revert Closed();
        if (block.timestamp > g.deadline) revert PastDeadline();
        if (index >= g.milestones.length) revert BadParams();
        if (index > 0 && g.milestones[index - 1].status != Status.Released) revert OutOfOrder();
        Milestone storage m = g.milestones[index];
        if (m.status != Status.Pending) revert BadStatus();
        if (commit == bytes20(0)) revert BadParams();
        m.status = Status.Claimed;
        m.commit = commit;
        m.evidence = evidence;
        emit MilestoneClaimed(id, index, commit, evidence);
    }

    /// @notice A reviewer approves a claimed milestone; reaching the threshold releases the funds.
    function approveMilestone(uint256 id, uint256 index) external nonReentrant {
        Grant storage g = _grant(id);
        if (g.closed) revert Closed();
        if (!_isReviewer(g, msg.sender)) revert NotReviewer();
        if (index >= g.milestones.length) revert BadParams();
        Milestone storage m = g.milestones[index];
        if (m.status != Status.Claimed) revert BadStatus();
        if (voted[id][index][msg.sender]) revert AlreadyVoted();
        voted[id][index][msg.sender] = true;
        m.approvals += 1;
        emit MilestoneApproved(id, index, msg.sender, m.approvals);
        if (m.approvals >= g.threshold) {
            m.status = Status.Released;
            g.released += m.amount;
            emit MilestoneReleased(id, index, g.recipient, m.amount);
            _pay(g.token, g.recipient, m.amount);
        }
    }

    /// @notice After the deadline the funder reclaims everything not yet released and closes the grant.
    function reclaim(uint256 id) external nonReentrant {
        Grant storage g = _grant(id);
        if (msg.sender != g.funder) revert NotFunder();
        if (g.closed) revert Closed();
        if (block.timestamp <= g.deadline) revert BeforeDeadline();
        g.closed = true;
        uint256 refund = uint256(g.total) - uint256(g.released);
        emit GrantClosed(id, refund);
        if (refund > 0) _pay(g.token, g.funder, refund);
    }

    // ----------------------------------------------------------------- views
    function grantCount() external view returns (uint256) {
        return _grants.length;
    }

    function grantInfo(uint256 id) external view returns (GrantInfo memory r) {
        Grant storage g = _grant(id);
        r.funder = g.funder;
        r.token = g.token;
        r.recipient = g.recipient;
        r.total = g.total;
        r.released = g.released;
        r.createdAt = g.createdAt;
        r.deadline = g.deadline;
        r.threshold = g.threshold;
        r.closed = g.closed;
        r.reviewerCount = uint8(g.reviewers.length);
        r.milestoneCount = uint8(g.milestones.length);
    }

    function milestoneInfo(uint256 id, uint256 index) external view returns (MilestoneInfo memory r) {
        Grant storage g = _grant(id);
        if (index >= g.milestones.length) revert BadParams();
        Milestone storage m = g.milestones[index];
        r.amount = m.amount;
        r.status = uint8(m.status);
        r.approvals = m.approvals;
        r.commit = m.commit;
    }

    function reviewerAt(uint256 id, uint256 index) external view returns (address) {
        Grant storage g = _grant(id);
        if (index >= g.reviewers.length) revert BadParams();
        return g.reviewers[index];
    }

    function repoOf(uint256 id) external view returns (string memory) {
        return _grant(id).repo;
    }

    function evidenceOf(uint256 id, uint256 index) external view returns (string memory) {
        Grant storage g = _grant(id);
        if (index >= g.milestones.length) revert BadParams();
        return g.milestones[index].evidence;
    }

    // -------------------------------------------------------------- internals
    function _grant(uint256 id) private view returns (Grant storage) {
        if (id >= _grants.length) revert NoSuchGrant();
        return _grants[id];
    }

    function _isReviewer(Grant storage g, address who) private view returns (bool) {
        uint256 n = g.reviewers.length;
        for (uint256 i = 0; i < n; i++) {
            if (g.reviewers[i] == who) return true;
        }
        return false;
    }

    function _pull(address token, address from, uint256 amount) private {
        if (token.code.length == 0) revert BadParams();
        (bool ok, bytes memory ret) =
            token.call(abi.encodeWithSelector(IERC20Min.transferFrom.selector, from, address(this), amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _pay(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            (bool ok, bytes memory ret) =
                token.call(abi.encodeWithSelector(IERC20Min.transfer.selector, to, amount));
            if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        }
    }
}
