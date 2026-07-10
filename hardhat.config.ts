import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
const BSC_TESTNET_RPC_URL = process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const BSC_MAINNET_RPC_URL = process.env.BSC_MAINNET_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    bscTestnet: {
      url: BSC_TESTNET_RPC_URL,
      chainId: 97,
      accounts: [PRIVATE_KEY],
    },
    bscMainnet: {
      url: BSC_MAINNET_RPC_URL,
      chainId: 56,
      accounts: [PRIVATE_KEY],
    },
  },
  etherscan: {
    apiKey: BSCSCAN_API_KEY,
  },
  sourcify: {
    enabled: false,
  },
};

export default config;
