import { ethers } from "hardhat";

/**
 * Post-deployment setup script.
 *
 * Usage:
 *   CONTRACT_ADDRESS=0x... WHITELIST_ADDRS=0x...,0x... npx hardhat run scripts/setup.ts --network bscTestnet
 *
 * Environment variables:
 *   CONTRACT_ADDRESS  - Deployed GasSponsor contract address
 *   WHITELIST_ADDRS   - Comma-separated list of addresses to whitelist
 *   FUND_AMOUNT_BNB   - Amount of BNB to send to the gas pool (default: 0.01)
 */
async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error("CONTRACT_ADDRESS environment variable is required");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Running setup with account:", deployer.address);

  // Attach to deployed contract
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gasSponsor: any = await ethers.getContractAt("GasSponsor", contractAddress);

  // Verify ownership
  const owner = await gasSponsor.owner();
  console.log("Contract owner:", owner);
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Deployer (${deployer.address}) is not the contract owner (${owner})`);
  }

  // Fund gas pool
  const fundAmount = process.env.FUND_AMOUNT_BNB || "0.01";
  const fundWei = ethers.parseEther(fundAmount);
  console.log(`\nFunding gas pool with ${fundAmount} BNB...`);
  const fundTx = await deployer.sendTransaction({
    to: contractAddress,
    value: fundWei,
  });
  await fundTx.wait();
  console.log("Gas pool funded. Contract balance:", ethers.formatEther(await ethers.provider.getBalance(contractAddress)), "BNB");

  // Whitelist addresses
  const whitelistAddrs = process.env.WHITELIST_ADDRS;
  if (whitelistAddrs) {
    const addresses = whitelistAddrs.split(",").map((a) => a.trim());
    const statuses = addresses.map(() => true);

    console.log(`\nWhitelisting ${addresses.length} address(es)...`);
    if (addresses.length === 1) {
      const tx = await gasSponsor.updateWhitelist(addresses[0], true);
      await tx.wait();
    } else {
      const tx = await gasSponsor.updateWhitelistBulk(addresses, statuses);
      await tx.wait();
    }

    for (const addr of addresses) {
      const isWhitelisted = await gasSponsor.whitelist(addr);
      console.log(`  ${addr} -> whitelisted: ${isWhitelisted}`);
    }
  } else {
    console.log("\nNo WHITELIST_ADDRS provided, skipping whitelist setup.");
  }

  // Summary
  console.log("\n--- Setup Summary ---");
  console.log(`Contract:         ${contractAddress}`);
  console.log(`Owner:            ${owner}`);
  console.log(`Gas Pool Balance: ${ethers.formatEther(await ethers.provider.getBalance(contractAddress))} BNB`);
  console.log("---------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
