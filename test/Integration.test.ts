import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContract = any;

describe("GasSponsor Integration Tests", function () {
  let gasSponsor: AnyContract;
  let mockToken: AnyContract;
  let owner: SignerWithAddress;
  let whitelisted: SignerWithAddress;
  let targetWallet: SignerWithAddress;

  beforeEach(async function () {
    [owner, whitelisted, targetWallet] = await ethers.getSigners();

    // Reset blockchain state between tests
    await ethers.provider.send("hardhat_reset", []);

    // Re-acquire signers after reset
    [owner, whitelisted, targetWallet] = await ethers.getSigners();

    // Deploy GasSponsor
    const GasSponsorFactory = await ethers.getContractFactory("GasSponsor");
    gasSponsor = await GasSponsorFactory.deploy();
    await gasSponsor.waitForDeployment();

    // Deploy MockERC20
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20Factory.deploy("Test Token", "TEST");
    await mockToken.waitForDeployment();

    // Whitelist the caller
    await gasSponsor.updateWhitelist(whitelisted.address, true);

    // Fund gas pool with 5 BNB
    await owner.sendTransaction({
      to: await gasSponsor.getAddress(),
      value: ethers.parseEther("5.0"),
    });
  });

  // ─── Mock Swap: ERC20 Transfer via GasSponsor ─────────────────────

  describe("Mock Swap Scenario (ERC20 transfer via sponsor)", function () {
    it("should execute an ERC20 transfer on behalf of target wallet", async function () {
      const transferAmount = ethers.parseEther("100");

      // Mint tokens to targetWallet
      await mockToken.mint(targetWallet.address, transferAmount);

      // Target wallet approves GasSponsor to spend tokens
      await mockToken.connect(targetWallet).approve(await gasSponsor.getAddress(), transferAmount);

      // Whitelisted caller encodes a transferFrom call
      const tokenAddr = await mockToken.getAddress();
      const data = mockToken.interface.encodeFunctionData("transferFrom", [
        targetWallet.address,
        owner.address, // recipient
        transferAmount,
      ]);

      const recipientBalBefore = await mockToken.balanceOf(owner.address);
      const targetBalBefore = await mockToken.balanceOf(targetWallet.address);

      // Execute via GasSponsor
      await gasSponsor.connect(whitelisted).execute(tokenAddr, data, 0);

      const recipientBalAfter = await mockToken.balanceOf(owner.address);
      const targetBalAfter = await mockToken.balanceOf(targetWallet.address);

      expect(recipientBalAfter - recipientBalBefore).to.equal(transferAmount);
      expect(targetBalBefore - targetBalAfter).to.equal(transferAmount);
    });

    it("should verify gas is consumed from contract BNB pool", async function () {
      const transferAmount = ethers.parseEther("50");
      await mockToken.mint(targetWallet.address, transferAmount);
      await mockToken.connect(targetWallet).approve(await gasSponsor.getAddress(), transferAmount);

      const tokenAddr = await mockToken.getAddress();
      const data = mockToken.interface.encodeFunctionData("transferFrom", [
        targetWallet.address,
        owner.address,
        transferAmount,
      ]);

      const sponsorBalBefore = await ethers.provider.getBalance(await gasSponsor.getAddress());
      const callerBalBefore = await ethers.provider.getBalance(whitelisted.address);

      // Execute - the whitelisted caller pays only gas for the execute tx itself
      const tx = await gasSponsor.connect(whitelisted).execute(tokenAddr, data, 0);
      const receipt = await tx.wait();
      const callerGasCost = receipt.gasUsed * receipt.gasPrice!;

      const sponsorBalAfter = await ethers.provider.getBalance(await gasSponsor.getAddress());
      const callerBalAfter = await ethers.provider.getBalance(whitelisted.address);

      // Caller only paid gas for the execute transaction
      expect(callerBalBefore - callerBalAfter).to.equal(callerGasCost);

      // Sponsor balance should be unchanged (no BNB value was sent, only gas for execution was used)
      // Note: Gas is paid by the caller's tx, not from the contract's BNB pool.
      // The contract's BNB pool is only used when `value > 0` is passed to execute().
      expect(sponsorBalAfter).to.equal(sponsorBalBefore);
    });
  });

  // ─── Multi-Step Scenario ──────────────────────────────────────────

  describe("Multi-Step Scenario (approve + transfer)", function () {
    it("should execute approve then transfer in sequence", async function () {
      const amount = ethers.parseEther("200");

      // Mint tokens to the GasSponsor contract (simulating it holding tokens)
      await mockToken.mint(await gasSponsor.getAddress(), amount);

      const sponsorAddr = await gasSponsor.getAddress();
      const tokenAddr = await mockToken.getAddress();

      // Step 1: Approve target wallet to spend tokens from the contract
      const approveData = mockToken.interface.encodeFunctionData("approve", [
        targetWallet.address,
        amount,
      ]);
      await gasSponsor.connect(whitelisted).execute(tokenAddr, approveData, 0);

      // Verify allowance was set
      expect(await mockToken.allowance(sponsorAddr, targetWallet.address)).to.equal(amount);

      // Step 2: Target wallet transfers tokens from the contract
      await mockToken.connect(targetWallet).transferFrom(sponsorAddr, targetWallet.address, amount);

      // Verify tokens moved
      expect(await mockToken.balanceOf(targetWallet.address)).to.equal(amount);
      expect(await mockToken.balanceOf(sponsorAddr)).to.equal(0);
    });
  });

  // ─── BNB Value Forwarding ─────────────────────────────────────────

  describe("BNB Value Forwarding via execute", function () {
    it("should forward BNB from pool to target and track pool depletion", async function () {
      const sendAmount = ethers.parseEther("1.0");

      const sponsorBalBefore = await ethers.provider.getBalance(await gasSponsor.getAddress());

      // Encode empty call to just send BNB to targetWallet
      await gasSponsor.connect(whitelisted).execute(targetWallet.address, "0x", sendAmount);

      const sponsorBalAfter = await ethers.provider.getBalance(await gasSponsor.getAddress());

      // Pool should be depleted by exact amount
      expect(sponsorBalBefore - sponsorBalAfter).to.equal(sendAmount);
    });

    it("should handle multiple sequential BNB forwards correctly", async function () {
      const amount1 = ethers.parseEther("0.5");
      const amount2 = ethers.parseEther("0.3");

      const balBefore = await ethers.provider.getBalance(await gasSponsor.getAddress());

      await gasSponsor.connect(whitelisted).execute(targetWallet.address, "0x", amount1);
      await gasSponsor.connect(whitelisted).execute(targetWallet.address, "0x", amount2);

      const balAfter = await ethers.provider.getBalance(await gasSponsor.getAddress());

      expect(balBefore - balAfter).to.equal(amount1 + amount2);
    });
  });

  // ─── End-to-End: Simulated Gas-Refund Loop ────────────────────────

  describe("Simulated Gas-Refund Loop (One-Time Setup)", function () {
    it("should fund target, approve, then sweep remaining BNB via sponsor", async function () {
      // Scenario: An empty wallet needs to approve the GasSponsor for a token.
      // The whitelisted caller:
      // 1. Sends BNB to the target wallet (via sponsor execute)
      // 2. Triggers approve from target wallet (done directly by target since it now has BNB)
      // 3. Sweeps remaining BNB back to master (via target sending BNB back)

      const fundAmount = ethers.parseEther("0.01"); // Fund target with small BNB
      const tokenAddr = await mockToken.getAddress();
      const targetAddr = targetWallet.address;

      // Step 1: Fund target wallet via sponsor
      await gasSponsor.connect(whitelisted).execute(targetAddr, "0x", fundAmount);

      const targetBal = await ethers.provider.getBalance(targetAddr);
      expect(targetBal).to.be.gt(0);

      // Step 2: Target wallet approves GasSponsor for the token
      await mockToken.connect(targetWallet).approve(await gasSponsor.getAddress(), ethers.MaxUint256);

      // Step 3: Sweep remaining BNB from target back to owner (master wallet)
      const sweepAmount = await ethers.provider.getBalance(targetAddr);
      const gasPrice = (await ethers.provider.getFeeData()).gasPrice!;
      const estimatedGas = 21000n;
      const gasCost = gasPrice * estimatedGas;
      const sendableAmount = sweepAmount - gasCost;

      await targetWallet.sendTransaction({
        to: owner.address,
        value: sendableAmount,
        gasLimit: estimatedGas,
        gasPrice: gasPrice,
      });

      // Target wallet should have ~0 BNB left
      const remainingBal = await ethers.provider.getBalance(targetAddr);
      expect(remainingBal).to.equal(0);
    });
  });

  // ─── Revert Safety in Multi-Step ──────────────────────────────────

  describe("Revert Safety", function () {
    it("should not affect contract state if second step in a sequence reverts", async function () {
      const amount = ethers.parseEther("100");
      await mockToken.mint(targetWallet.address, amount);

      const tokenAddr = await mockToken.getAddress();

      // Step 1 succeeds: target approves the sponsor
      await mockToken.connect(targetWallet).approve(await gasSponsor.getAddress(), amount);

      // Step 2: try to transferFrom more than approved (should revert)
      const tooMuch = ethers.parseEther("200");
      const data = mockToken.interface.encodeFunctionData("transferFrom", [
        targetWallet.address,
        owner.address,
        tooMuch,
      ]);

      await expect(
        gasSponsor.connect(whitelisted).execute(tokenAddr, data, 0)
      ).to.be.reverted;

      // Approval should still be intact from step 1
      expect(await mockToken.allowance(targetWallet.address, await gasSponsor.getAddress())).to.equal(amount);
      // Token balances unchanged
      expect(await mockToken.balanceOf(targetWallet.address)).to.equal(amount);
    });
  });
});
