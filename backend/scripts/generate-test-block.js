/**
 * generate-test-block.js
 *
 * Fetches the first company + its World-ID-verified employees from Supabase
 * and writes cre-workflow/my-workflow/test-block.json with real data.
 *
 * Usage:
 *   node backend/scripts/generate-test-block.js [companyId]
 *
 * If no companyId is passed it uses the first company in the DB.
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const OUTPUT_PATH = path.resolve(
  __dirname,
  "../../cre-workflow/my-workflow/test-block.json",
);

async function main() {
  const targetId = process.argv[2] ?? null;

  // ── Fetch company ──────────────────────────────────────────────────────────
  let companyQuery = supabase
    .from("companies")
    .select("id, wallet_address, chain_id, payment_asset, employees(id, name, salary_amount, preferred_asset, preferred_chain_id, settle_address, solana_address, world_id_verified)");

  if (targetId) {
    companyQuery = companyQuery.eq("id", targetId).single();
  } else {
    companyQuery = companyQuery.limit(1).single();
  }

  const { data: company, error } = await companyQuery;
  if (error || !company) {
    console.error("Could not load company:", error?.message ?? "not found");
    process.exit(1);
  }

  // ── Fetch splits for all employees ────────────────────────────────────────
  const empIds = company.employees.map((e) => e.id);
  const { data: splits } = await supabase
    .from("payroll_splits")
    .select("employee_id, percent, asset, chain_id, settle_address")
    .in("employee_id", empIds);

  const splitsByEmp = {};
  for (const s of splits ?? []) {
    (splitsByEmp[s.employee_id] ??= []).push({
      percent:       s.percent,
      asset:         s.asset,
      chain_id:      s.chain_id,
      settleAddress: s.settle_address,
    });
  }

  // ── Build test-block ───────────────────────────────────────────────────────
  const depositChainId = company.chain_id ?? 11155111;

  const employees = company.employees.map((emp) => {
    const empSplits = splitsByEmp[emp.id] ?? [];
    return {
      id:               emp.id,
      name:             emp.name,
      salaryUsdc:       emp.salary_amount,
      settleAddress:    emp.settle_address,
      solanaAddress:    emp.solana_address ?? null,
      preferredAsset:   emp.preferred_asset,
      preferredChainId: emp.preferred_chain_id ?? depositChainId,
      worldIdVerified:  emp.world_id_verified ?? false,
      ...(empSplits.length > 0 && {
        splits: empSplits.map((s) => ({
          percent:      s.percent,
          asset:        s.asset,
          chain_id:     s.chain_id,
          settleAddress: s.settleAddress,
        })),
      }),
    };
  });

  const testBlock = {
    companyId:      company.id,
    treasury:       company.wallet_address,
    depositChainId,
    employees,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(testBlock, null, 2));
  console.log(`Written: ${OUTPUT_PATH}`);
  console.log(`Company : ${company.id}`);
  console.log(`Treasury: ${company.wallet_address}`);
  console.log(`Chain   : ${depositChainId}`);
  console.log(`Employees (${employees.length}):`);
  for (const e of employees) {
    const splitInfo = e.splits ? ` [${e.splits.length} splits]` : "";
    const verTag    = e.worldIdVerified ? "✓" : "✗";
    console.log(`  ${verTag} ${e.name} — $${e.salaryUsdc} USDC → ${e.preferredAsset}${splitInfo}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
