import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying GasSponsor with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB");

  // Deploy GasSponsor
  const GasSponsorFactory = await ethers.getContractFactory("GasSponsor");
  const gasSponsor = await GasSponsorFactory.deploy();
  await gasSponsor.waitForDeployment();

  const contractAddress = await gasSponsor.getAddress();
  console.log("GasSponsor deployed to:", contractAddress);
  console.log("Owner:", await gasSponsor.owner());

  // Wait for confirmations before verifying
  console.log("\nWaiting for 5 block confirmations...");
  const deployTx = gasSponsor.deploymentTransaction();
  if (deployTx) {
    await deployTx.wait(5);
    console.log("5 confirmations received.");
  }

  // Attempt verification on BscScan
  const network = await ethers.provider.getNetwork();
  const networkName = network.chainId === 97n ? "bscTestnet" : network.chainId === 56n ? "bscMainnet" : "";
  if (networkName) {
    const explorerLabel = networkName === "bscTestnet" ? "BscScan Testnet" : "BscScan Mainnet";
    console.log(`\nVerifying contract on ${explorerLabel}...`);
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const hre = require("hardhat");
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [],
      });
      console.log(`Contract verified on ${explorerLabel}.`);
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message.includes("Already Verified")) {
        console.log("Contract is already verified.");
      } else {
        console.error("Verification failed:", err.message);
        console.log("You can verify manually with:");
        console.log(`npx hardhat verify --network ${networkName} ${contractAddress}`);
      }
    }
  } else {
    console.log("\nSkipping verification (unsupported network).");
  }

  console.log("\n--- Deployment Summary ---");
  console.log(`Contract Address: ${contractAddress}`);
  console.log(`Deployer/Owner:   ${deployer.address}`);
  console.log(`Network:          ${network.name} (chainId: ${network.chainId})`);
  console.log("--------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
