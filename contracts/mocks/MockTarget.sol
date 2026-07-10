// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockTarget
 * @notice A mock contract for testing the GasSponsor's generic `execute` function.
 *         Provides simple functions that can be called via the sponsor.
 */
contract MockTarget {
    uint256 public storedValue;
    address public lastCaller;
    uint256 public lastValue;

    event ValueStored(uint256 value, address caller, uint256 msgValue);

    /**
     * @notice Store a value. Can be called via GasSponsor.execute.
     * @param value The value to store.
     */
    function storeValue(uint256 value) external payable {
        storedValue = value;
        lastCaller = msg.sender;
        lastValue = msg.value;
        emit ValueStored(value, msg.sender, msg.value);
    }

    /**
     * @notice A function that always reverts, for testing revert handling.
     */
    function alwaysReverts() external pure {
        revert("MockTarget: always reverts");
    }

    /**
     * @notice A function that returns a value, for testing return data.
     * @return The stored value.
     */
    function getValue() external view returns (uint256) {
        return storedValue;
    }

    /**
     * @notice Receive BNB sent via execute.
     */
    receive() external payable {}
}
