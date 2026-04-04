/**
 * CRE workflow — payroll unit expansion tests
 * Run with: bun test tests/payroll-units.test.ts
 *
 * Mirrors the backend tests but for the TypeScript CRE version.
 * The logic is inlined here (CRE SDK build doesn't export sub-modules).
 */

import { test, expect, describe } from "bun:test";
import type { Employee, PayrollSplit } from "../types/types";

// ── Inline the pure logic under test ─────────────────────────────────────────
// (matches expandToPaymentUnits in main.ts exactly)

interface PaymentUnit extends Employee {
  _splitIndex:        number | null;
  _splitLabel:        string | null;
  splitSettleAddress: string | null;
}

function expandToPaymentUnits(employees: Employee[], depositChainId: number): PaymentUnit[] {
  const units: PaymentUnit[] = [];
  for (const emp of employees) {
    const splitSum   = emp.splits?.reduce((s, x) => s + x.percent, 0) ?? 0;
    const validSplits = emp.splits && emp.splits.length > 0 && splitSum === 100;

    if (validSplits) {
      emp.splits!.forEach((split: PayrollSplit, i: number) => {
        units.push({
          ...emp,
          preferredAsset:     split.asset,
          preferredChainId:   split.chain_id || depositChainId,
          salaryUsdc:         Number(((emp.salaryUsdc * split.percent) / 100).toFixed(6)),
          splitSettleAddress: split.settleAddress || null,
          _splitIndex:        i,
          _splitLabel:        `split ${i + 1}/${emp.splits!.length}`,
        });
      });
    } else {
      units.push({ ...emp, splitSettleAddress: null, _splitIndex: null, _splitLabel: null });
    }
  }
  return units;
}

function effectiveAddress(unit: PaymentUnit, type: "evm" | "sol" = "evm"): string {
  if (type === "sol") return unit.solanaAddress || unit.settleAddress;
  return unit.splitSettleAddress || unit.settleAddress;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_CHAIN = 11155111;

const alice: Employee = {
  id:               "emp-alice",
  name:             "Alice",
  salaryUsdc:       1000,
  preferredAsset:   "usdc",
  preferredChainId: 11155111,
  settleAddress:    "0xAlice",
  worldIdVerified:  true,
};

// ── No splits ─────────────────────────────────────────────────────────────────

describe("no splits", () => {
  test("produces a single unit with original asset/chain", () => {
    const units = expandToPaymentUnits([alice], DEFAULT_CHAIN);
    expect(units.length).toBe(1);
    expect(units[0].preferredAsset).toBe("usdc");
    expect(units[0].preferredChainId).toBe(11155111);
    expect(units[0].splitSettleAddress).toBeNull();
    expect(units[0]._splitLabel).toBeNull();
  });
});

// ── Valid splits ──────────────────────────────────────────────────────────────

describe("valid splits", () => {
  test("50/50 produces 2 units with correct salary", () => {
    const emp: Employee = {
      ...alice,
      splits: [
        { percent: 50, asset: "weth", chain_id: 42161 },
        { percent: 50, asset: "usdc", chain_id: 8453  },
      ],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    expect(units.length).toBe(2);
    expect(units[0].salaryUsdc).toBe(500);
    expect(units[1].salaryUsdc).toBe(500);
    expect(units[0]._splitLabel).toBe("split 1/2");
    expect(units[1]._splitLabel).toBe("split 2/2");
  });

  test("33/33/34 salary total is within 0.01 of original", () => {
    const emp: Employee = {
      ...alice,
      salaryUsdc: 1000,
      splits: [
        { percent: 33, asset: "weth", chain_id: 42161 },
        { percent: 33, asset: "usdc", chain_id: 42161 },
        { percent: 34, asset: "wbtc", chain_id: 42161 },
      ],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    const total = units.reduce((s, u) => s + u.salaryUsdc, 0);
    expect(Math.abs(total - 1000)).toBeLessThan(0.01);
  });

  test("split without chain_id uses depositChainId as fallback", () => {
    const emp: Employee = {
      ...alice,
      splits: [{ percent: 100, asset: "weth", chain_id: 0 }],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    expect(units[0].preferredChainId).toBe(DEFAULT_CHAIN);
  });
});

// ── Invalid splits — fallback to single unit ──────────────────────────────────

describe("invalid splits", () => {
  test("splits summing to 99 → single unit", () => {
    const emp: Employee = {
      ...alice,
      splits: [
        { percent: 50, asset: "weth", chain_id: 42161 },
        { percent: 49, asset: "usdc", chain_id: 42161 },
      ],
    };
    expect(expandToPaymentUnits([emp], DEFAULT_CHAIN).length).toBe(1);
  });

  test("empty splits array → single unit", () => {
    const emp: Employee = { ...alice, splits: [] };
    expect(expandToPaymentUnits([emp], DEFAULT_CHAIN).length).toBe(1);
  });
});

// ── Per-split custom wallet ────────────────────────────────────────────────────

describe("per-split custom wallet", () => {
  test("split with settleAddress populates splitSettleAddress", () => {
    const emp: Employee = {
      ...alice,
      splits: [
        { percent: 60, asset: "weth", chain_id: 42161, settleAddress: "0xSavings" },
        { percent: 40, asset: "usdc", chain_id: 42161 },
      ],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    expect(units[0].splitSettleAddress).toBe("0xSavings");
    expect(units[1].splitSettleAddress).toBeNull();
  });

  test("empty string settleAddress on split coerces to null", () => {
    const emp: Employee = {
      ...alice,
      splits: [{ percent: 100, asset: "weth", chain_id: 42161, settleAddress: "" }],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    expect(units[0].splitSettleAddress).toBeNull();
  });

  test("employee settleAddress is preserved alongside splitSettleAddress", () => {
    const emp: Employee = {
      ...alice,
      splits: [{ percent: 100, asset: "weth", chain_id: 42161, settleAddress: "0xSavings" }],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    expect(units[0].settleAddress).toBe("0xAlice");       // unchanged
    expect(units[0].splitSettleAddress).toBe("0xSavings"); // per-split override
  });
});

// ── effectiveAddress ──────────────────────────────────────────────────────────

describe("effectiveAddress", () => {
  const makeUnit = (override: Partial<PaymentUnit> = {}): PaymentUnit => ({
    ...alice,
    splitSettleAddress: null,
    _splitIndex: null,
    _splitLabel: null,
    ...override,
  });

  test("uses splitSettleAddress when set", () => {
    expect(effectiveAddress(makeUnit({ splitSettleAddress: "0xCustom" }))).toBe("0xCustom");
  });

  test("falls back to settleAddress when splitSettleAddress is null", () => {
    expect(effectiveAddress(makeUnit())).toBe("0xAlice");
  });

  test("SOL: uses solanaAddress when available", () => {
    expect(effectiveAddress(makeUnit({ solanaAddress: "SolWallet" }), "sol")).toBe("SolWallet");
  });

  test("SOL: falls back to settleAddress if no solanaAddress", () => {
    expect(effectiveAddress(makeUnit(), "sol")).toBe("0xAlice");
  });

  test("SOL: ignores splitSettleAddress", () => {
    expect(
      effectiveAddress(makeUnit({ splitSettleAddress: "0xCustom", solanaAddress: "SolWallet" }), "sol")
    ).toBe("SolWallet");
  });
});

// ── CRE on-chain report: recipients use effective address ─────────────────────

describe("Step 5 — on-chain report recipients", () => {
  test("recipients array uses splitSettleAddress when set", () => {
    const emp: Employee = {
      ...alice,
      splits: [
        { percent: 60, asset: "weth", chain_id: 42161, settleAddress: "0xSavings" },
        { percent: 40, asset: "usdc", chain_id: 42161 },
      ],
    };
    const units   = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    const queued  = units.map(u => ({ ...u, status: "queued" as const }));
    const recipients = queued.map(u => effectiveAddress(u));

    expect(recipients[0]).toBe("0xSavings");
    expect(recipients[1]).toBe("0xAlice");
  });

  test("recipients array falls back to default when no custom wallet", () => {
    const emp: Employee = {
      ...alice,
      splits: [
        { percent: 100, asset: "weth", chain_id: 42161 },
      ],
    };
    const units  = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    const recipients = units.map(u => effectiveAddress(u));
    expect(recipients[0]).toBe("0xAlice");
  });
});

// ── Full routing matrix: all supported asset/chain pairs ──────────────────────

describe("routing matrix", () => {
  const CHAINS: Record<string, number> = {
    sepolia:     11155111,
    baseSepolia: 84532,
    arbitrum:    42161,
    base:        8453,
  };

  const EVM_ASSETS = ["usdc", "weth", "usdt", "wbtc", "dai"];

  for (const [chainName, chainId] of Object.entries(CHAINS)) {
    for (const asset of EVM_ASSETS) {
      test(`single-unit: ${asset.toUpperCase()} on ${chainName}`, () => {
        const emp: Employee = { ...alice, preferredAsset: asset, preferredChainId: chainId };
        const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
        expect(units.length).toBe(1);
        expect(units[0].preferredAsset).toBe(asset);
        expect(units[0].preferredChainId).toBe(chainId);
      });

      test(`split with custom wallet: ${asset.toUpperCase()} on ${chainName}`, () => {
        const emp: Employee = {
          ...alice,
          splits: [{ percent: 100, asset, chain_id: chainId, settleAddress: "0xVault" }],
        };
        const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
        expect(units[0].splitSettleAddress).toBe("0xVault");
        expect(effectiveAddress(units[0])).toBe("0xVault");
      });
    }
  }

  test("USDC Arbitrum → WETH Base cross-chain, both with separate wallets", () => {
    const emp: Employee = {
      ...alice,
      salaryUsdc: 2000,
      splits: [
        { percent: 50, asset: "usdc", chain_id: 42161, settleAddress: "0xArbWallet" },
        { percent: 50, asset: "weth", chain_id: 8453,  settleAddress: "0xBaseWallet" },
      ],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    expect(effectiveAddress(units[0])).toBe("0xArbWallet");
    expect(effectiveAddress(units[1])).toBe("0xBaseWallet");
  });

  test("SOL payout uses solanaAddress not splitSettleAddress", () => {
    const emp: Employee = {
      ...alice,
      solanaAddress: "SolWallet123",
      splits: [
        { percent: 50, asset: "sol", chain_id: 1399811149, settleAddress: "0xIgnored" },
        { percent: 50, asset: "usdc", chain_id: 42161,    settleAddress: "0xUSDCWallet" },
      ],
    };
    const units = expandToPaymentUnits([emp], DEFAULT_CHAIN);
    const solUnit  = units.find(u => u.preferredAsset === "sol")!;
    const evmUnit  = units.find(u => u.preferredAsset === "usdc")!;

    expect(effectiveAddress(solUnit, "sol")).toBe("SolWallet123");
    expect(effectiveAddress(evmUnit)).toBe("0xUSDCWallet");
  });
});
