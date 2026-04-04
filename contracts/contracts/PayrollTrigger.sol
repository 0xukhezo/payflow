// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  PayrollTrigger
 * @notice On-chain trigger for the PayFlow CRE payroll workflow.
 *
 *         A company owner calls requestPayroll() → emits PayrollRequested →
 *         the Chainlink CRE DON picks up the event and runs the full
 *         payroll verification workflow (oracle prices, Uniswap quotes,
 *         rate attestation) before dispatching payments.
 *
 *         The event carries:
 *           treasury       — the company wallet holding USDC
 *           depositChainId — the chain where USDC lives (and swaps originate)
 *
 *         Employee data (IDs, names, salaries, splits) is fetched off-chain
 *         by the CRE workflow from the PayFlow backend using the treasury
 *         address as the lookup key, keeping sensitive HR data off-chain.
 */
contract PayrollTrigger {

    // ── Events ────────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when a company requests a payroll run.
     * @param treasury       Company wallet address holding USDC.
     * @param depositChainId Chain ID where USDC is held (e.g. 42161 Arbitrum).
     * @param requestedBy    Address that called requestPayroll().
     */
    event PayrollRequested(
        address indexed treasury,
        uint256 indexed depositChainId,
        address indexed requestedBy
    );

    // ── Errors ────────────────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroChainId();

    // ── Trigger ───────────────────────────────────────────────────────────────

    /**
     * @notice Request a payroll run for the given treasury on the specified chain.
     *         Anyone can call this — the CRE workflow validates World ID
     *         verification and oracle rates before moving any funds.
     *
     * @param treasury       Company wallet address.
     * @param depositChainId Chain ID where USDC is held.
     */
    function requestPayroll(address treasury, uint256 depositChainId) external {
        if (treasury == address(0))  revert ZeroAddress();
        if (depositChainId == 0)     revert ZeroChainId();

        emit PayrollRequested(treasury, depositChainId, msg.sender);
    }
}
