const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "C2FLR");

  // Relayer and TEE keys from env (same deployer for hackathon)
  const relayerAddress = process.env.RELAYER_ADDRESS || deployer.address;
  const teePublicKey = process.env.TEE_PUBLIC_KEY || deployer.address;

  console.log("\nDeploying PayrollLedger...");
  const PayrollLedger = await ethers.getContractFactory("PayrollLedger");
  const payrollLedger = await PayrollLedger.deploy(relayerAddress);
  await payrollLedger.waitForDeployment();
  const payrollLedgerAddress = await payrollLedger.getAddress();
  console.log("PayrollLedger deployed to:", payrollLedgerAddress);

  console.log("\nDeploying TEEVerifier...");
  const TEEVerifier = await ethers.getContractFactory("TEEVerifier");
  const teeVerifier = await TEEVerifier.deploy(teePublicKey);
  await teeVerifier.waitForDeployment();
  const teeVerifierAddress = await teeVerifier.getAddress();
  console.log("TEEVerifier deployed to:", teeVerifierAddress);

  // Write deployments.json (nested by network)
  const deploymentsPath = path.join(__dirname, "../deployments.json");
  let deployments = {};
  if (fs.existsSync(deploymentsPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  }
  deployments.coston2 = {
    network: "coston2",
    chainId: 114,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      ...(deployments.coston2?.contracts ?? {}),
      PayrollLedger: payrollLedgerAddress,
      TEEVerifier: teeVerifierAddress,
    },
  };
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("\nDeployments written to contracts/deployments.json");

  // Update backend/.env
  const backendEnvPath = path.join(__dirname, "../../backend/.env");
  if (fs.existsSync(backendEnvPath)) {
    let backendEnv = fs.readFileSync(backendEnvPath, "utf8");
    backendEnv = updateOrAddEnvVar(backendEnv, "PAYROLL_LEDGER_ADDRESS", payrollLedgerAddress);
    backendEnv = updateOrAddEnvVar(backendEnv, "TEE_VERIFIER_ADDRESS", teeVerifierAddress);
    fs.writeFileSync(backendEnvPath, backendEnv);
    console.log("Updated backend/.env with contract addresses");
  }

  console.log("\n=== Deployment Summary ===");
  console.log("PayrollLedger: ", payrollLedgerAddress);
  console.log("TEEVerifier:   ", teeVerifierAddress);
  console.log("\nCoston2 Explorer:");
  console.log(`  PayrollLedger: https://coston2.testnet.flarescan.com/address/${payrollLedgerAddress}`);
  console.log(`  TEEVerifier:   https://coston2.testnet.flarescan.com/address/${teeVerifierAddress}`);
}

function updateOrAddEnvVar(envContent, key, value) {
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(envContent)) {
    return envContent.replace(regex, `${key}=${value}`);
  }
  return envContent + `\n${key}=${value}`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
