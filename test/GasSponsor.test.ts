import { expect } from "chai";
import { ethers } from "hardhat";
import { GasSponsor, MockTarget, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContract = any;

describe("GasSponsor", function () {
  let gasSponsor: AnyContract;
  let mockTarget: AnyContract;
  let owner: SignerWithAddress;
  let whitelisted: SignerWithAddress;
  let unauthorized: SignerWithAddress;
  let other: SignerWithAddress;

  beforeEach(async function () {
    [owner, whitelisted, unauthorized, other] = await ethers.getSigners();

    const GasSponsorFactory = await ethers.getContractFactory("GasSponsor");
    gasSponsor = await GasSponsorFactory.deploy();
    await gasSponsor.waitForDeployment();

    const MockTargetFactory = await ethers.getContractFactory("MockTarget");
    mockTarget = await MockTargetFactory.deploy();
    await mockTarget.waitForDeployment();
  });

  // ─── Whitelist & Access Control (UAT-01, UAT-02, UAT-03) ─────────

  describe("Whitelist Management", function () {
    it("should set deployer as owner", async function () {
      expect(await gasSponsor.owner()).to.equal(owner.address);
    });

    it("should allow owner to add address to whitelist", async function () {
      await gasSponsor.updateWhitelist(whitelisted.address, true);
      expect(await gasSponsor.whitelist(whitelisted.address)).to.be.true;
    });

    it("should allow owner to remove address from whitelist", async function () {
      await gasSponsor.updateWhitelist(whitelisted.address, true);
      await gasSponsor.updateWhitelist(whitelisted.address, false);
      expect(await gasSponsor.whitelist(whitelisted.address)).to.be.false;
    });

    it("should emit WhitelistUpdated event on single update", async function () {
      await expect(gasSponsor.updateWhitelist(whitelisted.address, true))
        .to.emit(gasSponsor, "WhitelistUpdated")
        .withArgs(whitelisted.address, true);
    });

    it("should revert when non-owner calls updateWhitelist", async function () {
      await expect(
        gasSponsor.connect(unauthorized).updateWhitelist(whitelisted.address, true)
      ).to.be.revertedWithCustomError(gasSponsor, "OwnableUnauthorizedAccount");
    });

    // ─── Bulk Whitelist ────────────────────────────────────────────

    it("should allow owner to bulk add addresses", async function () {
      const accounts = [whitelisted.address, unauthorized.address, other.address];
      const statuses = [true, true, true];
      await gasSponsor.updateWhitelistBulk(accounts, statuses);

      expect(await gasSponsor.whitelist(whitelisted.address)).to.be.true;
      expect(await gasSponsor.whitelist(unauthorized.address)).to.be.true;
      expect(await gasSponsor.whitelist(other.address)).to.be.true;
    });

    it("should allow owner to bulk remove addresses", async function () {
      // First add them
      await gasSponsor.updateWhitelistBulk(
        [whitelisted.address, unauthorized.address],
        [true, true]
      );
      // Then remove them
      await gasSponsor.updateWhitelistBulk(
        [whitelisted.address, unauthorized.address],
        [false, false]
      );

      expect(await gasSponsor.whitelist(whitelisted.address)).to.be.false;
      expect(await gasSponsor.whitelist(unauthorized.address)).to.be.false;
    });

    it("should emit WhitelistBulkUpdated event", async function () {
      const accounts = [whitelisted.address, unauthorized.address];
      const statuses = [true, true];
      await expect(gasSponsor.updateWhitelistBulk(accounts, statuses))
        .to.emit(gasSponsor, "WhitelistBulkUpdated")
        .withArgs(accounts, statuses);
    });

    it("should revert bulk update on mismatched array lengths", async function () {
      await expect(
        gasSponsor.updateWhitelistBulk(
          [whitelisted.address, unauthorized.address],
          [true]
        )
      ).to.be.revertedWithCustomError(gasSponsor, "ArrayLengthMismatch");
    });

    it("should revert when non-owner calls updateWhitelistBulk", async function () {
      await expect(
        gasSponsor.connect(unauthorized).updateWhitelistBulk(
          [whitelisted.address],
          [true]
        )
      ).to.be.revertedWithCustomError(gasSponsor, "OwnableUnauthorizedAccount");
    });
  });

  // ─── Execute Function (UAT-01, UAT-02, UAT-03) ───────────────────

  describe("Execute", function () {
    beforeEach(async function () {
      // Whitelist the caller
      await gasSponsor.updateWhitelist(whitelisted.address, true);
      // Fund the gas pool
      await owner.sendTransaction({
        to: await gasSponsor.getAddress(),
        value: ethers.parseEther("1.0"),
      });
    });

    it("should revert when called by non-whitelisted address (UAT-01)", async function () {
      const data = mockTarget.interface.encodeFunctionData("storeValue", [42]);
      await expect(
        gasSponsor.connect(unauthorized).execute(await mockTarget.getAddress(), data, 0)
      ).to.be.revertedWithCustomError(gasSponsor, "NotWhitelisted");
    });

    it("should execute successfully when called by whitelisted address (UAT-02)", async function () {
      const data = mockTarget.interface.encodeFunctionData("storeValue", [42]);
      await gasSponsor.connect(whitelisted).execute(await mockTarget.getAddress(), data, 0);

      expect(await mockTarget.storedValue()).to.equal(42);
    });

    it("should revert after whitelist is revoked (UAT-03)", async function () {
      // Revoke whitelist
      await gasSponsor.updateWhitelist(whitelisted.address, false);

      const data = mockTarget.interface.encodeFunctionData("storeValue", [42]);
      await expect(
        gasSponsor.connect(whitelisted).execute(await mockTarget.getAddress(), data, 0)
      ).to.be.revertedWithCustomError(gasSponsor, "NotWhitelisted");
    });

    it("should forward BNB value to target", async function () {
      const value = ethers.parseEther("0.1");
      const data = mockTarget.interface.encodeFunctionData("storeValue", [100]);

      await gasSponsor.connect(whitelisted).execute(await mockTarget.getAddress(), data, value);

      expect(await mockTarget.lastValue()).to.equal(value);
      expect(await ethers.provider.getBalance(await mockTarget.getAddress())).to.equal(value);
    });

    it("should bubble up revert on failed inner call", async function () {
      const data = mockTarget.interface.encodeFunctionData("alwaysReverts", []);

      await expect(
        gasSponsor.connect(whitelisted).execute(await mockTarget.getAddress(), data, 0)
      ).to.be.revertedWithCustomError(gasSponsor, "ExecutionFailed");
    });

    it("should emit Executed event on success", async function () {
      const data = mockTarget.interface.encodeFunctionData("storeValue", [99]);
      await expect(
        gasSponsor.connect(whitelisted).execute(await mockTarget.getAddress(), data, 0)
      ).to.emit(gasSponsor, "Executed");
    });

    it("should deduct BNB from contract balance, not caller balance", async function () {
      const value = ethers.parseEther("0.5");
      const data = mockTarget.interface.encodeFunctionData("storeValue", [1]);

      const sponsorBalBefore = await ethers.provider.getBalance(await gasSponsor.getAddress());
      const callerBalBefore = await ethers.provider.getBalance(whitelisted.address);

      const tx = await gasSponsor.connect(whitelisted).execute(await mockTarget.getAddress(), data, value);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const sponsorBalAfter = await ethers.provider.getBalance(await gasSponsor.getAddress());
      const callerBalAfter = await ethers.provider.getBalance(whitelisted.address);

      // Contract balance should decrease by exactly the value sent
      expect(sponsorBalBefore - sponsorBalAfter).to.equal(value);
      // Caller balance should only decrease by gas cost of the tx itself
      expect(callerBalBefore - callerBalAfter).to.equal(gasUsed);
    });
  });

  // ─── Financial Safety (UAT-06, UAT-07) ───────────────────────────

  describe("Emergency Withdrawals", function () {
    it("should allow owner to withdraw all BNB (UAT-06)", async function () {
      const depositAmount = ethers.parseEther("2.0");
      await owner.sendTransaction({
        to: await gasSponsor.getAddress(),
        value: depositAmount,
      });

      const ownerBalBefore = await ethers.provider.getBalance(owner.address);
      const tx = await gasSponsor.emergencyWithdrawBNB();
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice!;
      const ownerBalAfter = await ethers.provider.getBalance(owner.address);

      expect(await ethers.provider.getBalance(await gasSponsor.getAddress())).to.equal(0);
      expect(ownerBalAfter - ownerBalBefore).to.equal(depositAmount - gasUsed);
    });

    it("should emit EmergencyWithdrawBNB event", async function () {
      const depositAmount = ethers.parseEther("1.0");
      await owner.sendTransaction({
        to: await gasSponsor.getAddress(),
        value: depositAmount,
      });

      await expect(gasSponsor.emergencyWithdrawBNB())
        .to.emit(gasSponsor, "EmergencyWithdrawBNB")
        .withArgs(owner.address, depositAmount);
    });

    it("should revert when non-owner calls emergencyWithdrawBNB", async function () {
      await expect(
        gasSponsor.connect(unauthorized).emergencyWithdrawBNB()
      ).to.be.revertedWithCustomError(gasSponsor, "OwnableUnauthorizedAccount");
    });

    it("should allow owner to rescue stuck ERC20 tokens", async function () {
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockERC20Factory.deploy("Test Token", "TEST");
      await mockToken.waitForDeployment();

      // Send tokens to the contract
      const amount = ethers.parseEther("500");
      await mockToken.mint(await gasSponsor.getAddress(), amount);

      // Owner rescues tokens
      await gasSponsor.emergencyWithdrawToken(await mockToken.getAddress());

      expect(await mockToken.balanceOf(owner.address)).to.equal(amount);
      expect(await mockToken.balanceOf(await gasSponsor.getAddress())).to.equal(0);
    });

    it("should emit EmergencyWithdrawToken event", async function () {
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockERC20Factory.deploy("Test Token", "TEST");
      await mockToken.waitForDeployment();

      const amount = ethers.parseEther("100");
      await mockToken.mint(await gasSponsor.getAddress(), amount);

      await expect(gasSponsor.emergencyWithdrawToken(await mockToken.getAddress()))
        .to.emit(gasSponsor, "EmergencyWithdrawToken")
        .withArgs(owner.address, await mockToken.getAddress(), amount);
    });

    it("should revert when non-owner calls emergencyWithdrawToken", async function () {
      await expect(
        gasSponsor.connect(unauthorized).emergencyWithdrawToken(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(gasSponsor, "OwnableUnauthorizedAccount");
    });

    it("should not drain BNB on failed inner call (revert safety)", async function () {
      // Whitelist caller and fund pool
      await gasSponsor.updateWhitelist(whitelisted.address, true);
      const depositAmount = ethers.parseEther("1.0");
      await owner.sendTransaction({
        to: await gasSponsor.getAddress(),
        value: depositAmount,
      });

      const balBefore = await ethers.provider.getBalance(await gasSponsor.getAddress());

      // Try a call that reverts
      const data = mockTarget.interface.encodeFunctionData("alwaysReverts", []);
      await expect(
        gasSponsor.connect(whitelisted).execute(await mockTarget.getAddress(), data, 0)
      ).to.be.reverted;

      // Contract balance should be unchanged
      const balAfter = await ethers.provider.getBalance(await gasSponsor.getAddress());
      expect(balBefore).to.equal(balAfter);
    });
  });

  // ─── Gas Pool (receive) ───────────────────────────────────────────

  describe("Gas Pool (receive)", function () {
    it("should accept BNB deposits via receive()", async function () {
      const depositAmount = ethers.parseEther("0.5");
      await owner.sendTransaction({
        to: await gasSponsor.getAddress(),
        value: depositAmount,
      });

      expect(await ethers.provider.getBalance(await gasSponsor.getAddress())).to.equal(depositAmount);
    });

    it("should emit BNBDeposited event on receive", async function () {
      const depositAmount = ethers.parseEther("0.5");
      await expect(
        owner.sendTransaction({
          to: await gasSponsor.getAddress(),
          value: depositAmount,
        })
      ).to.emit(gasSponsor, "BNBDeposited").withArgs(owner.address, depositAmount);
    });

    it("should accumulate multiple deposits correctly", async function () {
      const first = ethers.parseEther("0.3");
      const second = ethers.parseEther("0.7");

      await owner.sendTransaction({ to: await gasSponsor.getAddress(), value: first });
      await owner.sendTransaction({ to: await gasSponsor.getAddress(), value: second });

      expect(await ethers.provider.getBalance(await gasSponsor.getAddress())).to.equal(first + second);
    });
  });
});
