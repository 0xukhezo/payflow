// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PayrollDispatcher
 * @notice Chainlink CRE receiver contract for PayFlow.
 *
 *         The CRE workflow runs on Chainlink's decentralised node network:
 *           1. Reads ETH/USD, BTC/USD from Chainlink Data Feeds
 *           2. Reaches multi-node consensus on exchange rates
 *           3. Verifies per-employee Uniswap quotes against oracle prices
 *           4. Calls writeReport() → this contract's onReport()
 *
 *         onReport() decodes the oracle-verified payroll manifest and
 *         disperses USDC from the company treasury to each employee.
 *
 * Report encoding (rawReport):
 *   abi.encode(bytes32 payrollId, address treasury, address[] recipients, uint256[] amounts)
 *   amounts are in USDC units with 6 decimal places.
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract PayrollDispatcher {

    // ── State ─────────────────────────────────────────────────────────────────

    address public owner;
    IERC20  public immutable usdc;

    /// @notice Chainlink CRE KeystoneForwarder — only this address may call onReport()
    address public forwarder;

    // ── Events ────────────────────────────────────────────────────────────────

    event PayrollDispatched(
        bytes32 indexed payrollId,
        address indexed treasury,
        uint256 employeeCount,
        uint256 totalUsdc,
        uint256 timestamp
    );

    event EmployeePaid(
        bytes32 indexed payrollId,
        address indexed recipient,
        uint256 usdcAmount
    );

    event ForwarderUpdated(address indexed previous, address indexed next);

    // ── Errors ────────────────────────────────────────────────────────────────

    error NotOwner();
    error NotForwarder();
    error ZeroAddress();
    error LengthMismatch();
    error NoRecipients();
    error InsufficientAllowance(uint256 required, uint256 actual);
    error TransferFailed();

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyForwarder() {
        if (msg.sender != forwarder) revert NotForwarder();
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    /**
     * @param _usdc      USDC token contract (6 decimals)
     * @param _forwarder Chainlink CRE KeystoneForwarder address
     */
    constructor(address _usdc, address _forwarder) {
        if (_usdc == address(0))      revert ZeroAddress();
        if (_forwarder == address(0)) revert ZeroAddress();
        owner    = msg.sender;
        usdc     = IERC20(_usdc);
        forwarder = _forwarder;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setForwarder(address _forwarder) external onlyOwner {
        if (_forwarder == address(0)) revert ZeroAddress();
        emit ForwarderUpdated(forwarder, _forwarder);
        forwarder = _forwarder;
    }

    function transferOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        owner = _newOwner;
    }

    // ── IReceiver ─────────────────────────────────────────────────────────────

    /**
     * @notice Entry point called by the Chainlink CRE KeystoneForwarder
     *         after the node network reaches consensus on the payroll manifest.
     *
     * @param  metadata  Workflow execution context (workflowId, owner, reportId)
     *                   Forwarded as-is from the CRE network — not used here
     *                   but kept for interface compliance.
     * @param  rawReport ABI-encoded payroll data produced by the CRE workflow:
     *                   abi.encode(bytes32 payrollId, address treasury,
     *                              address[] recipients, uint256[] amounts)
     */
    function onReport(
        bytes calldata metadata,
        bytes calldata rawReport
    ) external onlyForwarder {
        // silence unused-var warning while keeping the parameter for interface parity
        metadata;

        (
            bytes32        payrollId,
            address        treasury,
            address[] memory recipients,
            uint256[] memory amounts
        ) = abi.decode(rawReport, (bytes32, address, address[], uint256[]));

        if (recipients.length != amounts.length) revert LengthMismatch();
        if (recipients.length == 0)              revert NoRecipients();

        // ── Pre-flight: verify allowance covers the full payroll ──────────────
        uint256 total;
        for (uint256 i; i < amounts.length; ) {
            total += amounts[i];
            unchecked { ++i; }
        }

        uint256 allowed = usdc.allowance(treasury, address(this));
        if (allowed < total) revert InsufficientAllowance(total, allowed);

        // ── Pull total USDC from treasury in one transferFrom ─────────────────
        bool ok = usdc.transferFrom(treasury, address(this), total);
        if (!ok) revert TransferFailed();

        // ── Distribute to each employee ───────────────────────────────────────
        for (uint256 i; i < recipients.length; ) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            bool sent = usdc.transfer(recipients[i], amounts[i]);
            if (!sent) revert TransferFailed();
            emit EmployeePaid(payrollId, recipients[i], amounts[i]);
            unchecked { ++i; }
        }

        emit PayrollDispatched(
            payrollId,
            treasury,
            recipients.length,
            total,
            block.timestamp
        );
    }

    // ── View ──────────────────────────────────────────────────────────────────

    /**
     * @notice Returns how much USDC a given treasury has approved for this contract.
     *         The frontend can call this to check if "Approve USDC" is needed before
     *         the CRE workflow triggers a payroll run.
     */
    function approvedAllowance(address treasury) external view returns (uint256) {
        return usdc.allowance(treasury, address(this));
    }
}
