import { ethers } from "hardhat";

/**
 * End-to-end gas sponsorship test on BSC Testnet.
 * Tests the full flow: deployer sponsors BNB for a separate wallet via the contract.
 *
 * Usage:
 *   CONTRACT_ADDRESS=0x... npx hardhat run scripts/test-gas-sponsor.ts --network bscTestnet
 */

const CONFIRMATIONS = 3;
const READ_DELAY_MS = 4000; // BSC Testnet RPC nodes can be slow to sync

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error("CONTRACT_ADDRESS environment variable is required");
  }

  const [deployer] = await ethers.getSigners();

  // Generate a separate test wallet (simulating an "empty" wallet that will receive gas-sponsored BNB)
  const emptyWallet = ethers.Wallet.createRandom().connect(ethers.provider);

  console.log("==============================================");
  console.log("  Gas Sponsor E2E Test - BSC Testnet");
  console.log("==============================================");
  console.log(`Contract:      ${contractAddress}`);
  console.log(`Deployer:      ${deployer.address}`);
  console.log(`Empty Wallet:  ${emptyWallet.address}`);
  console.log("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gasSponsor: any = await ethers.getContractAt("GasSponsor", contractAddress);

  let passed = 0;
  let failed = 0;

  function check(name: string, condition: boolean, detail: string) {
    if (condition) {
      console.log(`  [PASS] ${name}: ${detail}`);
      passed++;
    } else {
      console.log(`  [FAIL] ${name}: ${detail}`);
      failed++;
    }
  }

  async function sendAndWait(label: string, txPromise: Promise<any>) {
    console.log(`  Sending: ${label}...`);
    const tx = await txPromise;
    const receipt = await tx.wait(CONFIRMATIONS);
    console.log(`  Confirmed (${CONFIRMATIONS} blocks). Tx: ${receipt.hash}`);
    // Allow RPC nodes to sync state
    await delay(READ_DELAY_MS);
    return receipt;
  }

  // ── Step 1: Fund the gas pool ──────────────────────────────────
  console.log("\n--- Step 1: Fund Gas Pool ---");
  const fundAmount = ethers.parseEther("0.005");
  const balBefore = await ethers.provider.getBalance(contractAddress);
  console.log(`  Pool balance before: ${ethers.formatEther(balBefore)} BNB`);

  await sendAndWait(
    "Send 0.005 BNB to gas pool",
    deployer.sendTransaction({ to: contractAddress, value: fundAmount })
  );

  const balAfter = await ethers.provider.getBalance(contractAddress);
  console.log(`  Pool balance after:  ${ethers.formatEther(balAfter)} BNB`);
  check("Fund pool", balAfter > balBefore, `${ethers.formatEther(balBefore)} -> ${ethers.formatEther(balAfter)} BNB`);

  // ── Step 2: Whitelist the deployer ─────────────────────────────
  console.log("\n--- Step 2: Whitelist Deployer ---");
  const isAlreadyWhitelisted = await gasSponsor.whitelist(deployer.address);
  if (!isAlreadyWhitelisted) {
    await sendAndWait(
      "Whitelist deployer",
      gasSponsor.updateWhitelist(deployer.address, true)
    );
  } else {
    console.log("  Deployer already whitelisted.");
  }
  const wlStatus = await gasSponsor.whitelist(deployer.address);
  check("Whitelist status", wlStatus === true, `Whitelisted: ${wlStatus}`);

  // ── Step 3: Verify empty wallet has 0 BNB ──────────────────────
  console.log("\n--- Step 3: Verify Empty Wallet Has No BNB ---");
  const emptyBalBefore = await ethers.provider.getBalance(emptyWallet.address);
  console.log(`  Empty wallet balance: ${ethers.formatEther(emptyBalBefore)} BNB`);
  check("Empty wallet is empty", emptyBalBefore === 0n, `Balance: ${ethers.formatEther(emptyBalBefore)} BNB`);

  // ── Step 4: Gas-sponsored BNB transfer to empty wallet ─────────
  console.log("\n--- Step 4: Execute Gas-Sponsored Transfer ---");
  const sponsorAmount = ethers.parseEther("0.001");
  console.log(`  Sponsoring ${ethers.formatEther(sponsorAmount)} BNB to empty wallet...`);

  const deployerBalBefore = await ethers.provider.getBalance(deployer.address);
  const poolBalBefore = await ethers.provider.getBalance(contractAddress);

  await sendAndWait(
    `execute(emptyWallet, 0x, ${ethers.formatEther(sponsorAmount)} BNB)`,
    gasSponsor.connect(deployer).execute(emptyWallet.address, "0x", sponsorAmount)
  );

  // Extra delay for balance queries after execute
  await delay(READ_DELAY_MS);

  const deployerBalAfter = await ethers.provider.getBalance(deployer.address);
  const poolBalAfter = await ethers.provider.getBalance(contractAddress);
  const emptyBalAfter = await ethers.provider.getBalance(emptyWallet.address);

  console.log(`  Pool balance:   ${ethers.formatEther(poolBalBefore)} -> ${ethers.formatEther(poolBalAfter)} BNB`);
  console.log(`  Empty wallet:   ${ethers.formatEther(emptyBalBefore)} -> ${ethers.formatEther(emptyBalAfter)} BNB`);
  console.log(`  Deployer spent: ${ethers.formatEther(deployerBalBefore - deployerBalAfter)} BNB (tx gas only)`);

  check("Pool depleted by exact amount", poolBalBefore - poolBalAfter === sponsorAmount, `Delta: ${ethers.formatEther(poolBalBefore - poolBalAfter)} BNB`);
  check("Empty wallet received BNB", emptyBalAfter === sponsorAmount, `Received: ${ethers.formatEther(emptyBalAfter)} BNB`);
  check("Deployer only paid tx gas", deployerBalBefore - deployerBalAfter < ethers.parseEther("0.001"), `Cost: ${ethers.formatEther(deployerBalBefore - deployerBalAfter)} BNB`);

  // ── Step 5: Unauthorized caller is blocked ─────────────────────
  console.log("\n--- Step 5: Unauthorized Caller Blocked ---");
  const unauthorizedWallet = ethers.Wallet.createRandom().connect(ethers.provider);
  try {
    const failTx = await gasSponsor.connect(unauthorizedWallet).execute(deployer.address, "0x", 0);
    await failTx.wait(1);
    check("Unauthorized blocked", false, "Transaction did NOT revert");
  } catch {
    check("Unauthorized blocked", true, "Transaction reverted as expected");
  }

  // ── Step 6: Emergency Withdraw BNB ─────────────────────────────
  console.log("\n--- Step 6: Emergency Withdraw BNB ---");
  const poolBal = await ethers.provider.getBalance(contractAddress);
  console.log(`  Pool balance before withdraw: ${ethers.formatEther(poolBal)} BNB`);

  await sendAndWait("emergencyWithdrawBNB()", gasSponsor.emergencyWithdrawBNB());

  const poolBalFinal = await ethers.provider.getBalance(contractAddress);
  console.log(`  Pool balance after withdraw:  ${ethers.formatEther(poolBalFinal)} BNB`);
  check("Pool drained to 0", poolBalFinal === 0n, `Final balance: ${ethers.formatEther(poolBalFinal)} BNB`);

  // ── Step 7: Remove whitelist entry ─────────────────────────────
  console.log("\n--- Step 7: Remove Whitelist Entry ---");
  await sendAndWait(
    "Remove deployer from whitelist",
    gasSponsor.updateWhitelist(deployer.address, false)
  );
  const wlAfter = await gasSponsor.whitelist(deployer.address);
  check("Whitelist removed", wlAfter === false, `Whitelisted: ${wlAfter}`);

  // ── Summary ────────────────────────────────────────────────────
  console.log("\n==============================================");
  console.log(`  Results: ${passed} passed, ${failed} failed out of ${passed + failed} checks`);
  console.log("==============================================");

  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
