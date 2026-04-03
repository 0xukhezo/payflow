/**
 * Payroll routing unit tests
 * Run with: node --test tests/payroll-routing.test.js
 *
 * Covers:
 *  - expandToPaymentUnits: all split / no-split / invalid-split cases
 *  - effectiveAddress: per-split custom wallet vs default fallback
 *  - Salary arithmetic for 50/50, 33/33/34, single-unit
 *  - SOL routing (SideShift path) uses solanaAddress
 *  - CRE dispatch path: every unit carries splitSettleAddress
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { expandToPaymentUnits, effectiveAddress } from "../src/utils/payroll-units.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_CHAIN = 11155111; // Sepolia

const alice = {
  id: "emp-alice",
  name: "Alice",
  salaryAmount: 1000,
  preferredAsset: "usdc",
  preferredChainId: 11155111,
  settleAddress: "0xAlice",
  worldIdVerified: true,
};

const bob = {
  id: "emp-bob",
  name: "Bob",
  salaryAmount: 2000,
  preferredAsset: "weth",
  preferredChainId: 42161,
  settleAddress: "0xBob",
  worldIdVerified: true,
};

// ── expandToPaymentUnits ──────────────────────────────────────────────────────

describe("expandToPaymentUnits — no splits", () => {
  test("employee with no splits produces a single unit", () => {
    const units = expandToPaymentUnits([alice], DEFAULT_CHAIN);
    assert.equal(units.length, 1);
    assert.equal(units[0].id, "emp-alice");
    assert.equal(units[0]._stepKey, "emp-alice");
    assert.equal(units[0]._splitLabel, null);
  });

  test("single unit keeps employee preferredAsset and preferredChainId", () => {
    const units = expandToPaymentUnits([alice], DEFAULT_CHAIN);
    assert.equal(units[0].preferredAsset, "usdc");
    assert.equal(units[0].preferredChainId, 11155111);
    assert.equal(units[0].salaryAmount, 1000);
  });

  test("single unit has splitSettleAddress null", () => {
    const units = expandToPaymentUnits([alice], DEFAULT_CHAIN);
    assert.equal(units[0].splitSettleAddress, null);
  });

  test("multiple employees without splits produce one unit each", () => {
    const units = expandToPaymentUnits([alice, bob], DEFAULT_CHAIN);
    assert.equal(units.length, 2);
    assert.equal(units[0].id, "emp-alice");
    assert.equal(units[1].id, "emp-bob");
  });
});

describe("expandToPaymentUnits — valid splits", () => {
  const splitEmployee = {
    ...alice,
    splits: [
      { percent: 50, asset: "weth",  chain_id: 42161 },
      { percent: 50, asset: "usdc",  chain_id: 8453  },
    ],
  };

  test("50/50 split produces 2 units", () => {
    const units = expandToPaymentUnits([splitEmployee], DEFAULT_CHAIN);
    assert.equal(units.length, 2);
  });

  test("split units get correct asset and chain from the split row", () => {
    const units = expandToPaymentUnits([splitEmployee], DEFAULT_CHAIN);
    assert.equal(units[0].preferredAsset, "weth");
    assert.equal(units[0].preferredChainId, 42161);
    assert.equal(units[1].preferredAsset, "usdc");
    assert.equal(units[1].preferredChainId, 8453);
  });

  test("50/50 salary split is correct", () => {
    const units = expandToPaymentUnits([splitEmployee], DEFAULT_CHAIN);
    assert.equal(units[0].salaryAmount, 500);
    assert.equal(units[1].salaryAmount, 500);
  });

  test("33/33/34 salary split sums to original salary", () => {
    const emp = {
      ...alice,
      salaryAmount: 1000,
      splits: [
        { percent: 33, asset: "weth", chain_id: 42161 },
        { percent: 33, asset: "usdc", chain_id: 42161 },
        { percent: 34, asset: "wbtc", chain_id: 42161 },
      ],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    assert.equal(units.length, 3);
    const total = units.reduce((s, u) => s + u.salaryAmount, 0);
    assert.ok(Math.abs(total - 1000) < 0.01, `expected ~1000, got ${total}`);
  });

  test("split step keys are unique and labelled", () => {
    const units = expandToPaymentUnits([splitEmployee], DEFAULT_CHAIN);
    assert.equal(units[0]._stepKey, "emp-alice_s0");
    assert.equal(units[1]._stepKey, "emp-alice_s1");
    assert.equal(units[0]._splitLabel, "split 1/2");
    assert.equal(units[1]._splitLabel, "split 2/2");
  });

  test("split unit without chain_id falls back to defaultChainId", () => {
    const emp = {
      ...alice,
      splits: [
        { percent: 100, asset: "weth", chain_id: 0 },
      ],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    assert.equal(units[0].preferredChainId, DEFAULT_CHAIN);
  });
});

describe("expandToPaymentUnits — invalid splits (fall back to single unit)", () => {
  test("splits summing to 99 are invalid — produces single unit", () => {
    const emp = {
      ...alice,
      splits: [
        { percent: 50, asset: "weth", chain_id: 42161 },
        { percent: 49, asset: "usdc", chain_id: 42161 },
      ],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    assert.equal(units.length, 1);
    assert.equal(units[0].preferredAsset, alice.preferredAsset);
  });

  test("splits summing to 101 are invalid — produces single unit", () => {
    const emp = {
      ...alice,
      splits: [
        { percent: 60, asset: "weth", chain_id: 42161 },
        { percent: 41, asset: "usdc", chain_id: 42161 },
      ],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    assert.equal(units.length, 1);
  });

  test("empty splits array produces single unit", () => {
    const emp = { ...alice, splits: [] };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    assert.equal(units.length, 1);
  });

  test("null splits produces single unit", () => {
    const emp = { ...alice, splits: null };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    assert.equal(units.length, 1);
  });

  test("undefined splits produces single unit", () => {
    const units = expandToPaymentUnits([alice], DEFAULT_CHAIN);
    assert.equal(units.length, 1);
  });
});

// ── Per-split custom wallet (settleAddress on split) ──────────────────────────

describe("expandToPaymentUnits — per-split custom wallet", () => {
  test("split with settleAddress sets splitSettleAddress on unit", () => {
    const emp = {
      ...alice,
      splits: [
        { percent: 60, asset: "weth", chain_id: 42161, settleAddress: "0xSavingsWallet" },
        { percent: 40, asset: "usdc", chain_id: 42161 },
      ],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    assert.equal(units[0].splitSettleAddress, "0xSavingsWallet");
    assert.equal(units[1].splitSettleAddress, null);
  });

  test("split with empty settleAddress coerces to null", () => {
    const emp = {
      ...alice,
      splits: [
        { percent: 100, asset: "weth", chain_id: 42161, settleAddress: "" },
      ],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    assert.equal(units[0].splitSettleAddress, null);
  });

  test("employee settleAddress is NOT overwritten on the unit", () => {
    const emp = {
      ...alice,
      splits: [
        { percent: 100, asset: "weth", chain_id: 42161, settleAddress: "0xSavingsWallet" },
      ],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    // Original settleAddress still present for fallback
    assert.equal(units[0].settleAddress, "0xAlice");
    assert.equal(units[0].splitSettleAddress, "0xSavingsWallet");
  });
});

// ── effectiveAddress ──────────────────────────────────────────────────────────

describe("effectiveAddress", () => {
  test("uses splitSettleAddress when set (EVM)", () => {
    const unit = { settleAddress: "0xDefault", splitSettleAddress: "0xCustom" };
    assert.equal(effectiveAddress(unit), "0xCustom");
  });

  test("falls back to settleAddress when splitSettleAddress is null", () => {
    const unit = { settleAddress: "0xDefault", splitSettleAddress: null };
    assert.equal(effectiveAddress(unit), "0xDefault");
  });

  test("falls back to settleAddress when splitSettleAddress is undefined", () => {
    const unit = { settleAddress: "0xDefault" };
    assert.equal(effectiveAddress(unit), "0xDefault");
  });

  test("SOL type uses solanaAddress when set", () => {
    const unit = { settleAddress: "0xEVM", solanaAddress: "SolWallet123", splitSettleAddress: null };
    assert.equal(effectiveAddress(unit, "sol"), "SolWallet123");
  });

  test("SOL type falls back to settleAddress when no solanaAddress", () => {
    const unit = { settleAddress: "0xEVM", splitSettleAddress: null };
    assert.equal(effectiveAddress(unit, "sol"), "0xEVM");
  });

  test("SOL type ignores splitSettleAddress (not applicable for Solana)", () => {
    const unit = { settleAddress: "0xEVM", solanaAddress: "SolWallet123", splitSettleAddress: "0xCustom" };
    assert.equal(effectiveAddress(unit, "sol"), "SolWallet123");
  });
});

// ── Routing coverage: all supported token/chain combinations ──────────────────

describe("routing coverage — all supported asset/chain combinations", () => {
  const chains = {
    sepolia:     11155111,
    baseSepolia: 84532,
    arbitrum:    42161,
    base:        8453,
  };

  const assets = ["usdc", "weth", "eth", "usdt", "dai", "wbtc", "sol"];

  for (const [chainName, chainId] of Object.entries(chains)) {
    for (const asset of assets) {
      // SOL is only valid as a cross-chain destination, not on EVM testnets
      if (asset === "sol" && (chainId === 11155111 || chainId === 84532)) continue;

      test(`single-unit route: ${asset.toUpperCase()} on ${chainName} (chain ${chainId})`, () => {
        const emp = {
          ...alice,
          preferredAsset: asset,
          preferredChainId: chainId,
          solanaAddress: asset === "sol" ? "SolWallet123" : undefined,
        };
        const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
        assert.equal(units.length, 1);
        assert.equal(units[0].preferredAsset, asset);
        assert.equal(units[0].preferredChainId, chainId);
      });

      test(`split-unit route: ${asset.toUpperCase()} on ${chainName} with custom wallet`, () => {
        const emp = {
          ...alice,
          splits: [
            { percent: 100, asset, chain_id: chainId, settleAddress: "0xCustomWallet" },
          ],
          solanaAddress: asset === "sol" ? "SolWallet123" : undefined,
        };
        const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
        assert.equal(units.length, 1);
        assert.equal(units[0].preferredAsset, asset);
        assert.equal(units[0].preferredChainId, chainId);
        assert.equal(units[0].splitSettleAddress, "0xCustomWallet");
        assert.equal(effectiveAddress(units[0]), "0xCustomWallet");
      });
    }
  }

  test("cross-chain split: USDC Arbitrum → WETH Base with separate wallets", () => {
    const emp = {
      ...alice,
      salaryAmount: 2000,
      splits: [
        { percent: 50, asset: "usdc", chain_id: 42161, settleAddress: "0xArbitrumWallet" },
        { percent: 50, asset: "weth", chain_id: 8453,  settleAddress: "0xBaseWallet" },
      ],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    assert.equal(units.length, 2);
    assert.equal(effectiveAddress(units[0]), "0xArbitrumWallet");
    assert.equal(effectiveAddress(units[1]), "0xBaseWallet");
    assert.equal(units[0].salaryAmount, 1000);
    assert.equal(units[1].salaryAmount, 1000);
  });

  test("mixed split: some splits with custom wallet, some without", () => {
    const emp = {
      ...alice,
      salaryAmount: 3000,
      splits: [
        { percent: 33, asset: "weth", chain_id: 42161, settleAddress: "0xSavings" },
        { percent: 33, asset: "usdc", chain_id: 8453  },
        { percent: 34, asset: "wbtc", chain_id: 42161 },
      ],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    assert.equal(units.length, 3);
    assert.equal(effectiveAddress(units[0]), "0xSavings");     // custom
    assert.equal(effectiveAddress(units[1]), alice.settleAddress); // default
    assert.equal(effectiveAddress(units[2]), alice.settleAddress); // default
  });
});
