/**
 * Deploy PayrollTrigger to Sepolia.
 *
 * The PayrollTrigger contract is the on-chain entry point for the CRE workflow.
 * Companies call requestPayroll(treasury, depositChainId) → emits PayrollRequested →
 * CRE DON picks up the event and runs the full verification + dispatch workflow.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-trigger.js --network sepolia
 *
 * Required env (contracts/.env):
 *   PRIVATE_KEY — deployer wallet private key
 */

const { ethers, network } = require("hardhat");
const fs   = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const chainIdNum  = Number(chainId);

  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("═══════════════════════════════════════════════");
  console.log("  PayFlow · PayrollTrigger Deployment");
  console.log(`  Network: ${network.name} (chainId ${chainIdNum})`);
  console.log("═══════════════════════════════════════════════");
  console.log("Deployer:", deployer.address);
  console.log("Balance: ", ethers.formatEther(balance), "ETH");
  console.log();

  console.log("Deploying PayrollTrigger...");
  const PayrollTrigger = await ethers.getContractFactory("PayrollTrigger");
  const trigger        = await PayrollTrigger.deploy();
  await trigger.waitForDeployment();
  const address = await trigger.getAddress();

  console.log("✓ PayrollTrigger deployed:", address);
  console.log(`  Explorer: https://sepolia.etherscan.io/address/${address}`);

  // ── Update deployments.json ───────────────────────────────────────────────
  const deploymentsPath = path.join(__dirname, "../deployments.json");
  let deployments = {};
  if (fs.existsSync(deploymentsPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  }
  deployments[network.name] = {
    ...deployments[network.name],
    contracts: {
      ...(deployments[network.name]?.contracts ?? {}),
      PayrollTrigger: address,
    },
  };
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("✓ deployments.json updated");

  // ── Update CRE workflow staging config ───────────────────────────────────
  const stagingConfigPath = path.join(
    __dirname,
    "../../cre-workflow/my-workflow/config/config.staging.json",
  );
  if (fs.existsSync(stagingConfigPath)) {
    const cfg = JSON.parse(fs.readFileSync(stagingConfigPath, "utf8"));
    cfg.triggerContractAddress = address;
    fs.writeFileSync(stagingConfigPath, JSON.stringify(cfg, null, 2));
    console.log("✓ config.staging.json updated with triggerContractAddress");
  }

  // ── Update backend/.env ───────────────────────────────────────────────────
  const backendEnvPath = path.join(__dirname, "../../backend/.env");
  if (fs.existsSync(backendEnvPath)) {
    let env = fs.readFileSync(backendEnvPath, "utf8");
    env = upsert(env, "PAYROLL_TRIGGER_ADDRESS", address);
    fs.writeFileSync(backendEnvPath, env);
    console.log("✓ backend/.env updated with PAYROLL_TRIGGER_ADDRESS");
  }

  console.log("\n═══════════════════════════════════════════════");
  console.log("  NEXT STEPS");
  console.log("═══════════════════════════════════════════════");
  console.log("1. Set triggerContractAddress in CRE config files");
  console.log("2. Register & deploy the CRE workflow on the DON:");
  console.log("   cre workflow deploy ./my-workflow -T staging-settings");
  console.log("3. Frontend: call PayrollTrigger.requestPayroll(treasury, chainId)");
  console.log("   Event topic0: 0xdddc44ebd25e9809781bd368117a87083c8cc338999ef43c41471a9c6d47bfd7");
}

function upsert(content, key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(content)
    ? content.replace(re, `${key}=${value}`)
    : content + `\n${key}=${value}`;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
