/**
 * Deploy PayrollDispatcher to any supported network.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-dispatcher.js --network sepolia
 *   npx hardhat run scripts/deploy-dispatcher.js --network arbitrum
 *   npx hardhat run scripts/deploy-dispatcher.js --network base
 *
 * Required env (contracts/.env):
 *   PRIVATE_KEY            — deployer wallet private key
 *   CRE_FORWARDER_ADDRESS  — Chainlink CRE KeystoneForwarder on target network
 *                            Leave unset to use placeholder (call setForwarder() later)
 *
 * Optional env (provide to override public RPC defaults):
 *   SEPOLIA_RPC_URL
 *   ARBITRUM_RPC_URL
 *   BASE_RPC_URL
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ── USDC addresses per network ────────────────────────────────────────────────
const USDC_BY_CHAIN = {
  11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Sepolia
  42161:    "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum One
  8453:     "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base
};

// ── Explorer URLs per network ─────────────────────────────────────────────────
const EXPLORER_BY_CHAIN = {
  11155111: "https://sepolia.etherscan.io",
  42161:    "https://arbiscan.io",
  8453:     "https://basescan.org",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const chainIdNum = Number(chainId);

  const usdcAddress = USDC_BY_CHAIN[chainIdNum];
  if (!usdcAddress) {
    throw new Error(`Unsupported network chainId ${chainIdNum}. Add it to USDC_BY_CHAIN in deploy-dispatcher.js.`);
  }

  const explorer = EXPLORER_BY_CHAIN[chainIdNum] || "https://etherscan.io";
  const balance = await ethers.provider.getBalance(deployer.address);

  const CRE_FORWARDER = process.env.CRE_FORWARDER_ADDRESS || "0x0000000000000000000000000000000000000001";

  console.log("═══════════════════════════════════════════════");
  console.log("  PayFlow · PayrollDispatcher Deployment");
  console.log(`  Network: ${network.name} (chainId ${chainIdNum})`);
  console.log("═══════════════════════════════════════════════");
  console.log("Deployer:  ", deployer.address);
  console.log("Balance:   ", ethers.formatEther(balance), "ETH");
  console.log("USDC:      ", usdcAddress);
  console.log("Forwarder: ", CRE_FORWARDER);
  console.log();

  if (CRE_FORWARDER === "0x0000000000000000000000000000000000000001") {
    console.warn("⚠ CRE_FORWARDER_ADDRESS not set — using placeholder.");
    console.warn("  Call setForwarder() after deployment when the address is known.\n");
  }

  console.log("Deploying PayrollDispatcher...");
  const PayrollDispatcher = await ethers.getContractFactory("PayrollDispatcher");
  const dispatcher = await PayrollDispatcher.deploy(usdcAddress, CRE_FORWARDER);
  await dispatcher.waitForDeployment();
  const address = await dispatcher.getAddress();

  console.log("✓ PayrollDispatcher deployed to:", address);
  console.log(`  Explorer: ${explorer}/address/${address}`);

  // ── Update deployments.json ─────────────────────────────────────────────────
  const deploymentsPath = path.join(__dirname, "../deployments.json");
  let deployments = {};
  if (fs.existsSync(deploymentsPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  }
  deployments[network.name] = {
    network:   network.name,
    chainId:   chainIdNum,
    deployer:  deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      ...(deployments[network.name]?.contracts ?? {}),
      PayrollDispatcher: address,
    },
  };
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("\n✓ deployments.json updated");

  // ── Update CRE workflow staging config ──────────────────────────────────────
  const stagingConfigPath = path.join(
    __dirname,
    "../../cre-workflow/my-project/my-workflow/config/config.staging.json"
  );
  if (fs.existsSync(stagingConfigPath)) {
    const cfg = JSON.parse(fs.readFileSync(stagingConfigPath, "utf8"));
    cfg.dispatcherAddress = address;
    fs.writeFileSync(stagingConfigPath, JSON.stringify(cfg, null, 2));
    console.log("✓ cre-workflow config.staging.json updated with dispatcherAddress");
  }

  // ── Update backend/.env ─────────────────────────────────────────────────────
  const backendEnvPath = path.join(__dirname, "../../backend/.env");
  if (fs.existsSync(backendEnvPath)) {
    let env = fs.readFileSync(backendEnvPath, "utf8");
    env = upsert(env, "PAYROLL_DISPATCHER_ADDRESS", address);
    fs.writeFileSync(backendEnvPath, env);
    console.log("✓ backend/.env updated with PAYROLL_DISPATCHER_ADDRESS");
  }

  console.log("\n═══════════════════════════════════════════════");
  console.log("  NEXT STEPS");
  console.log("═══════════════════════════════════════════════");
  console.log("1. Approve PayrollDispatcher to spend USDC from each company treasury:");
  console.log(`   usdc.approve("${address}", totalPayrollAmount)`);
  if (CRE_FORWARDER === "0x0000000000000000000000000000000000000001") {
    console.log("2. Set the real CRE forwarder address:");
    console.log(`   dispatcher.setForwarder("<real CRE forwarder address>")`);
  }
  console.log("3. Set dispatcherAddress in cre-workflow/config/config.production.json");
}

function upsert(envContent, key, value) {
  const regex = new RegExp(`^${key}=.*$`, "m");
  return regex.test(envContent)
    ? envContent.replace(regex, `${key}=${value}`)
    : envContent + `\n${key}=${value}`;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
