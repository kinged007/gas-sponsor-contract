// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title GasSponsor
 * @notice A generic, DEX-agnostic gas sponsorship contract.
 *         Holds a centralized BNB pool and allows whitelisted callers
 *         to execute arbitrary operations on behalf of the contract,
 *         using the pool's BNB to cover gas/value costs.
 * @dev    All swap/transfer logic is constructed off-chain and passed
 *         as encoded calldata to the `execute` function.
 */
contract GasSponsor is Ownable {
    using SafeERC20 for IERC20;

    // ─── State ────────────────────────────────────────────────────────
    mapping(address => bool) public whitelist;

    // ─── Events ───────────────────────────────────────────────────────
    event WhitelistUpdated(address indexed account, bool status);
    event WhitelistBulkUpdated(address[] accounts, bool[] statuses);
    event Executed(address indexed caller, address indexed to, uint256 value, bytes data, bytes result);
    event BNBDeposited(address indexed sender, uint256 amount);
    event EmergencyWithdrawBNB(address indexed owner, uint256 amount);
    event EmergencyWithdrawToken(address indexed owner, address indexed token, uint256 amount);

    // ─── Errors ───────────────────────────────────────────────────────
    error NotWhitelisted(address caller);
    error ArrayLengthMismatch();
    error ExecutionFailed(bytes returnData);
    error TransferFailed();

    // ─── Constructor ──────────────────────────────────────────────────
    constructor() Ownable(msg.sender) {}

    // ─── Whitelist Management ─────────────────────────────────────────

    /**
     * @notice Add or remove a single address from the whitelist.
     * @param account  The address to update.
     * @param status   True to whitelist, false to revoke.
     */
    function updateWhitelist(address account, bool status) external onlyOwner {
        whitelist[account] = status;
        emit WhitelistUpdated(account, status);
    }

    /**
     * @notice Add or remove multiple addresses from the whitelist in one tx.
     * @param accounts  Array of addresses to update.
     * @param statuses  Array of booleans (must match accounts length).
     */
    function updateWhitelistBulk(
        address[] calldata accounts,
        bool[] calldata statuses
    ) external onlyOwner {
        if (accounts.length != statuses.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < accounts.length; i++) {
            whitelist[accounts[i]] = statuses[i];
        }

        emit WhitelistBulkUpdated(accounts, statuses);
    }

    // ─── Core Execution ───────────────────────────────────────────────

    /**
     * @notice Execute an arbitrary call using the contract's BNB pool.
     *         Only callable by whitelisted addresses.
     * @param to     Target contract or EOA address.
     * @param data   ABI-encoded calldata for the target.
     * @param value  Amount of BNB (wei) to send along with the call.
     * @return result  The raw bytes returned by the target call.
     */
    function execute(
        address to,
        bytes calldata data,
        uint256 value
    ) external returns (bytes memory result) {
        if (!whitelist[msg.sender]) revert NotWhitelisted(msg.sender);

        bool success;
        (success, result) = to.call{value: value}(data);

        if (!success) revert ExecutionFailed(result);

        emit Executed(msg.sender, to, value, data, result);
        return result;
    }

    // ─── Emergency Withdrawals ────────────────────────────────────────

    /**
     * @notice Withdraw the entire BNB balance of the contract to the owner.
     */
    function emergencyWithdrawBNB() external onlyOwner {
        uint256 balance = address(this).balance;
        (bool success, ) = payable(owner()).call{value: balance}("");
        if (!success) revert TransferFailed();
        emit EmergencyWithdrawBNB(owner(), balance);
    }

    /**
     * @notice Rescue stuck ERC20 tokens from the contract.
     * @param token  The ERC20 token address to rescue.
     */
    function emergencyWithdrawToken(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(owner(), balance);
        emit EmergencyWithdrawToken(owner(), token, balance);
    }

    // ─── Receive BNB ─────────────────────────────────────────────────

    /**
     * @notice Accept BNB deposits into the gas pool.
     */
    receive() external payable {
        emit BNBDeposited(msg.sender, msg.value);
    }
}
