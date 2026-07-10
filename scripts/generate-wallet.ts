import { ethers } from "hardhat";

async function main() {
  const wallet = ethers.Wallet.createRandom();

  console.log("=== New Wallet Generated ===");
  console.log("");
  console.log("Address:    ", wallet.address);
  console.log("Private Key:", wallet.privateKey);
  console.log("Mnemonic:   ", wallet.mnemonic?.phrase);
  console.log("");
  console.log("=== Copy these into .env ===");
  console.log(`PRIVATE_KEY=${wallet.privateKey}`);
  console.log("============================");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Copy the PRIVATE_KEY into your .env file");
  console.log("  2. Fund the wallet address with BNB testnet tokens");
  console.log("     Faucet: https://www.bnbchain.org/en/testnet-faucet");
  console.log("");
  console.log("WARNING: This wallet is NOT secure. For production use,");
  console.log("generate keys offline and store them in a hardware wallet.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
