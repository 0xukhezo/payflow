/**
 * CRE Workflow Runner
 *
 * Two modes, selected by env:
 *
 *   Deployed  (CRE_HTTP_TRIGGER_URL is set)
 *     POSTs the trigger payload to the live DON HTTP endpoint and returns
 *     { async: true } immediately. The DON processes the workflow and calls
 *     back POST /api/payroll/:id/run when done. The frontend polls for status.
 *
 *   Simulation  (default, no CRE_HTTP_TRIGGER_URL)
 *     Spawns `cre workflow simulate` as a local subprocess and streams the
 *     attestation results back through the SSE connection.
 */
import { spawn }                       from "child_process";
import path                            from "path";
import { fileURLToPath }               from "url";
import { symlinkSync, existsSync, readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Absolute paths
// CRE CLI must run from the project root (where project.yaml lives)
const CRE_BIN          = `${process.env.HOME}/.cre/bin/cre`;
const CRE_PROJECT_DIR  = path.resolve(__dirname, "../../../cre-workflow");
const WORKFLOW_PATH    = "./my-workflow";

// CRE CLI enforces a 97-char max on --config path. The real config path exceeds that,
// so we create a short symlink in /tmp pointing at the real file.
const REAL_CONFIG_PATH = path.join(CRE_PROJECT_DIR, "my-workflow/config/config.staging.json");
const WORKFLOW_CONFIG  = "/tmp/pf-cfg.json";
if (!existsSync(WORKFLOW_CONFIG)) {
  symlinkSync(REAL_CONFIG_PATH, WORKFLOW_CONFIG);
}

// Read backendApiUrl from the CRE config so the run-stream handler can poll
// the correct backend (Railway or localhost) for execution status.
export function getCreBackendUrl() {
  try {
    const cfg = JSON.parse(readFileSync(REAL_CONFIG_PATH, "utf8"));
    return cfg.backendApiUrl || null;
  } catch {
    return null;
  }
}

/**
 * Run the CRE workflow simulation, stream progress via onProgress, return attestation.
 *
 * @param {Object} triggerPayload  - { companyId, treasury, depositChainId, employees[] }
 * @param {Function} onProgress   - SSE callback: (step) => void
 * @param {number} timeoutMs      - max ms to wait for simulation (default 90s)
 * @returns {Object|null}          - parsed JSON result from workflow, or null on failure
 */
export async function runCreSimulation(triggerPayload, onProgress, timeoutMs = 90_000) {
  // ── Deployed mode ────────────────────────────────────────────────────────────
  // When CRE_HTTP_TRIGGER_URL is set the workflow runs on the real DON.
  // We fire the trigger and return immediately; the DON will call back
  // POST /api/payroll/:companyId/run when verification is complete.
  if (process.env.CRE_HTTP_TRIGGER_URL) {
    onProgress({
      id:     "cre_verify",
      label:  "CRE: Triggering Chainlink DON — workflow queued for on-chain verification...",
      status: "running",
    });
    try {
      await fetch(process.env.CRE_HTTP_TRIGGER_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(triggerPayload),
        signal:  AbortSignal.timeout(15_000),
      });
      onProgress({
        id:     "cre_verify",
        label:  "CRE: DON workflow accepted — Chainlink nodes are verifying rates...",
        status: "running",
      });
      return { async: true };
    } catch (err) {
      onProgress({
        id:     "cre_verify",
        label:  `CRE: DON unreachable (${err.message}) — falling back to inline verification`,
        status: "warning",
      });
      return null; // caller falls through to inline runPayroll()
    }
  }

  // ── Simulation mode (default) ─────────────────────────────────────────────
  onProgress({
    id:     "cre_verify",
    label:  "CRE: Connecting to Chainlink DON — fetching Uniswap quotes + oracle prices...",
    status: "running",
  });

  const payloadJson = JSON.stringify(triggerPayload);

  return new Promise((resolve) => {
    let fullOutput = "";
    let timedOut   = false;

    const proc = spawn(
      CRE_BIN,
      [
        "workflow", "simulate",
        WORKFLOW_PATH,
        "--config", WORKFLOW_CONFIG,
        "--http-payload", payloadJson,
        "--non-interactive",
        "--trigger-index", "0",
        "--target", "staging-settings",
      ],
      {
        cwd: CRE_PROJECT_DIR,
        env: {
          ...process.env,
          HOME:       process.env.HOME,
          CRE_TARGET: "staging-settings",
        },
      },
    );

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs);

    proc.stdout.on("data", (data) => {
      fullOutput += data.toString();
    });

    proc.stderr.on("data", (data) => {
      const line = data.toString().trim();
      if (line) console.error("[CRE stderr]", line);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);

      if (timedOut) {
        onProgress({ id: "cre_verify", label: "CRE: Simulation timed out — proceeding with inline verification", status: "warning" });
        return resolve(null);
      }

      if (code !== 0) {
        onProgress({ id: "cre_verify", label: "CRE: Simulation failed — proceeding with inline verification", status: "warning" });
        return resolve(null);
      }

      // Parse the JSON result from workflow output.
      // The CRE CLI wraps the workflow return value as a JSON-encoded string:
      //   "{\\"status\\":\\"ok\\",...}"
      // So we need to double-parse: JSON.parse(line) → inner string → JSON.parse again.
      let result = null;
      const lines = fullOutput.split('\n');
      const resultIdx = lines.findIndex(l => l.includes('Workflow Simulation Result'));
      if (resultIdx !== -1) {
        for (let i = resultIdx + 1; i < Math.min(resultIdx + 4, lines.length); i++) {
          const line = lines[i].trim();
          if (line.startsWith('"')) {
            try { result = JSON.parse(JSON.parse(line)); break; } catch { /* ignore */ }
          }
        }
      }
      if (!result) {
        // fallback: find any JSON block with "status" and "results"
        const m = fullOutput.match(/\{[\s\S]*?"results"\s*:\s*\[[\s\S]*?\]\s*\}/);
        if (m) {
          try { result = JSON.parse(m[0]); } catch { /* ignore */ }
        }
      }

      if (!result) {
        onProgress({ id: "cre_verify", label: "CRE: Could not parse simulation output — proceeding anyway", status: "warning" });
        return resolve(null);
      }

      // ── Stream attestation results as SSE steps ───────────────────────────

      // Chainlink oracle prices
      if (result.oracles) {
        const eth  = result.oracles["ETH/USD"]?.toFixed(2)  ?? "—";
        const btc  = result.oracles["BTC/USD"]?.toFixed(2)  ?? "—";
        const usdc = result.oracles["USDC/USD"]?.toFixed(6) ?? "—";
        onProgress({
          id:     "cre_chainlink",
          label:  `CRE: Chainlink prices — ETH $${eth}  ·  BTC $${btc}  ·  USDC $${usdc}`,
          status: "done",
        });
      }

      // USDC peg
      if (result.oracles?.pegDeviationBps != null) {
        const dev = (result.oracles.pegDeviationBps / 100).toFixed(2);
        onProgress({
          id:     "cre_peg",
          label:  `CRE: USDC peg — ${dev}% deviation ${result.oracles.pegPass ? "✓ PASS" : "✗ FAIL"}`,
          status: result.oracles.pegPass ? "done" : "error",
        });
      }

      // Per-employee Uniswap + rate attestation
      for (const r of result.results ?? []) {
        const pass = r.attestation?.withinRange ?? true;
        const dev  = r.deviationBps != null ? `${(r.deviationBps / 100).toFixed(2)}% slippage` : "";
        const quote = r.attestation?.quoteSource ?? "";
        onProgress({
          id:      `cre_attest_${r.employeeId}`,
          empId:   r.employeeId,
          empName: r.employeeName,
          label:   `CRE: ${r.employeeName} — ${r.settleAmount} ${r.settleAsset}  ${dev ? `· ${dev}` : ""}  ${quote ? `· ${quote}` : ""}  →  ${pass ? "✓ PASS" : "✗ FAIL"}`,
          status:  pass ? "done" : "error",
          attestation: r.attestation ? {
            swapRate:         r.settleAmount,
            chainlinkPrice:   r.oraclePrice,
            deviationPercent: r.deviationBps != null ? (r.deviationBps / 100).toFixed(2) : "0.00",
            toleranceBps:     r.attestation.toleranceBps,
            withinRange:      pass,
            settleCoin:       r.settleAsset,
          } : undefined,
        });
      }

      // Final summary
      const q = result.summary?.queued ?? 0;
      const f = result.summary?.failed ?? 0;
      onProgress({
        id:     "cre_verify",
        label:  `CRE: Verification complete — ${q} cleared${f > 0 ? `, ${f} failed` : ""} ✓`,
        status: f > 0 ? "warning" : "done",
      });

      resolve(result);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      onProgress({ id: "cre_verify", label: `CRE: CLI error — ${err.message}`, status: "warning" });
      resolve(null);
    });
  });
}
