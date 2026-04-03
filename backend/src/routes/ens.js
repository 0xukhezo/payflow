import { Router } from "express";
import { ethers } from "ethers";

const router = Router();

const RPC = {
  mainnet: process.env.ETHEREUM_RPC_URL      || "https://cloudflare-eth.com",
  sepolia: process.env.SEPOLIA_RPC_URL       || "https://ethereum-sepolia-rpc.publicnode.com",
};

// ENS registry is deployed at the same address on both mainnet and Sepolia
const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

// GET /api/ens/:name?network=mainnet|sepolia
// Resolves an ENS name to an address and reads PayFlow text records.
// Returns: { address, splits, solanaAddress }
// splits is parsed from the com.payflow.splits JSON text record (if set).
router.get("/:name", async (req, res) => {
  const { name } = req.params;
  const network = req.query.network === "sepolia" ? "sepolia" : "mainnet";

  if (!name.includes(".")) {
    return res.status(400).json({ error: "Invalid ENS name" });
  }

  try {
    const rpcUrl = RPC[network];
    const provider = network === "sepolia"
      ? new ethers.JsonRpcProvider(rpcUrl, {
          chainId: 11155111,
          name: "sepolia",
          ensAddress: ENS_REGISTRY,
        })
      : new ethers.JsonRpcProvider(rpcUrl, "mainnet");

    // Resolve address and get resolver in parallel
    const [address, resolver] = await Promise.all([
      provider.resolveName(name),
      provider.getResolver(name),
    ]);

    if (!address) {
      return res.status(404).json({ error: `ENS name "${name}" not found` });
    }

    let splits = null;
    let solanaAddress = null;

    if (resolver) {
      // ethers EnsResolver.getText() handles namehash internally
      const [splitsRaw, solRaw] = await Promise.all([
        resolver.getText("com.payflow.splits").catch(() => null),
        resolver.getText("com.payflow.solanaAddress").catch(() => null),
      ]);

      if (splitsRaw) {
        try {
          splits = JSON.parse(splitsRaw);
        } catch {
          // Not valid JSON — ignore
        }
      }
      if (solRaw) {
        solanaAddress = solRaw;
      }
    }

    res.json({ address, splits, solanaAddress });
  } catch (err) {
    console.error("[ens] resolve error:", err.message);
    res.status(500).json({ error: "ENS resolution failed" });
  }
});

export default router;
