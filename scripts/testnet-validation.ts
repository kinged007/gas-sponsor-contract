import { ethers } from "hardhat";

/**
 * Post-deployment validation script for BSC Testnet.
 * Runs a series of on-chain checks to verify the deployed contract is functional.
 *
 * Usage:
 *   CONTRACT_ADDRESS=0x... npx hardhat run scripts/testnet-validation.ts --network bscTestnet
 */

interface TestResult {
  id: string;
  description: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(id: string, description: string, passed: boolean, details: string) {
  results.push({ id, description, passed, details });
  const status = passed ? "PASS" : "FAIL";
  console.log(`  [${status}] ${id}: ${description} -- ${details}`);
}

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error("CONTRACT_ADDRESS environment variable is required");
  }

  const [deployer] = await ethers.getSigners();
  // Generate a random test address (unfunded, used for whitelist/execute tests)
  const testWallet = ethers.Wallet.createRandom();
  console.log("=== BSC Testnet Validation ===");
  console.log("Contract:", contractAddress);
  console.log("Deployer:", deployer.address);
  console.log("Test Addr:", testWallet.address);
  console.log("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gasSponsor: any = await ethers.getContractAt("GasSponsor", contractAddress);

  // ── Test 1: Confirm owner is deployer ──────────────────────────
  try {
    const owner = await gasSponsor.owner();
    record(
      "VAL-01",
      "Owner verification",
      owner.toLowerCase() === deployer.address.toLowerCase(),
      `Owner: ${owner}`
    );
  } catch (e: unknown) {
    const err = e as Error;
    record("VAL-01", "Owner verification", false, err.message);
  }

  // ── Test 2: Add test address to whitelist ──────────────────────
  try {
    const tx = await gasSponsor.updateWhitelist(testWallet.address, true);
    await tx.wait();
    const isWhitelisted = await gasSponsor.whitelist(testWallet.address);
    record("VAL-02", "Add to whitelist", isWhitelisted, `Whitelisted: ${isWhitelisted}`);
  } catch (e: unknown) {
    const err = e as Error;
    record("VAL-02", "Add to whitelist", false, err.message);
  }

  // ── Test 3: Verify whitelist state ─────────────────────────────
  try {
    const status = await gasSponsor.whitelist(testWallet.address);
    record("VAL-03", "Verify whitelist state", status === true, `Status: ${status}`);
  } catch (e: unknown) {
    const err = e as Error;
    record("VAL-03", "Verify whitelist state", false, err.message);
  }

  // ── Test 4: Remove test address from whitelist ─────────────────
  try {
    const tx = await gasSponsor.updateWhitelist(testWallet.address, false);
    await tx.wait();
    const isWhitelisted = await gasSponsor.whitelist(testWallet.address);
    record("VAL-04", "Remove from whitelist", !isWhitelisted, `Whitelisted: ${isWhitelisted}`);
  } catch (e: unknown) {
    const err = e as Error;
    record("VAL-04", "Remove from whitelist", false, err.message);
  }

  // ── Test 5: Fund gas pool with small BNB amount ────────────────
  try {
    const fundAmount = ethers.parseEther("0.001");
    const balBefore = await ethers.provider.getBalance(contractAddress);
    const tx = await deployer.sendTransaction({ to: contractAddress, value: fundAmount });
    await tx.wait();
    const balAfter = await ethers.provider.getBalance(contractAddress);
    const funded = balAfter > balBefore;
    record(
      "VAL-05",
      "Fund gas pool",
      funded,
      `Balance: ${ethers.formatEther(balBefore)} -> ${ethers.formatEther(balAfter)} BNB`
    );
  } catch (e: unknown) {
    const err = e as Error;
    record("VAL-05", "Fund gas pool", false, err.message);
  }

  // ── Test 6: Execute with whitelisted address ───────────────────
  try {
    // Re-whitelist the deployer for this test
    const wlTx = await gasSponsor.updateWhitelist(deployer.address, true);
    await wlTx.wait();

    // Execute a simple BNB send to testWallet address (0.0001 BNB)
    const sendAmount = ethers.parseEther("0.0001");
    const execTx = await gasSponsor.connect(deployer).execute(testWallet.address, "0x", sendAmount);
    await execTx.wait();
    record("VAL-06", "Execute via whitelisted caller", true, "Transaction confirmed");
  } catch (e: unknown) {
    const err = e as Error;
    record("VAL-06", "Execute via whitelisted caller", false, err.message);
  }

  // ── Test 7: Execute reverts for non-whitelisted caller ─────────
  // Use a random unfunded wallet to test that execute reverts for non-whitelisted callers
  const randomCaller = ethers.Wallet.createRandom().connect(ethers.provider);
  try {
    await gasSponsor.connect(randomCaller).execute(deployer.address, "0x", 0);
    record("VAL-07", "Revert on unauthorized execute", false, "Did not revert");
  } catch (e: unknown) {
    const err = e as Error;
    record("VAL-07", "Revert on unauthorized execute", true, `Reverted: ${err.message.substring(0, 80)}`);
  }

  // ── Test 8: Emergency withdraw BNB ─────────────────────────────
  try {
    const balBefore = await ethers.provider.getBalance(contractAddress);
    const tx = await gasSponsor.emergencyWithdrawBNB();
    await tx.wait();
    const balAfter = await ethers.provider.getBalance(contractAddress);
    record(
      "VAL-08",
      "Emergency withdraw BNB",
      balAfter === 0n,
      `Balance: ${ethers.formatEther(balBefore)} -> ${ethers.formatEther(balAfter)} BNB`
    );
  } catch (e: unknown) {
    const err = e as Error;
    record("VAL-08", "Emergency withdraw BNB", false, err.message);
  }

  // ── Summary ────────────────────────────────────────────────────
  console.log("\n=== Validation Summary ===");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`  - ${r.id}: ${r.description} -- ${r.details}`));
  } else {
    console.log("\nAll validation checks passed!");
  }
  console.log("=========================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
