# Chainlink CRE — Developer Feedback

**Project:** PayFlow — cross-chain crypto payroll
**SDK used:** `@chainlink/cre-sdk@1.4.0` (downgraded from 1.5.0)
**CLI used:** `cre workflow simulate` (local DON simulation)
**Context:** TypeScript workflow running on Chainlink DON — fetches Uniswap quotes, verifies rates against Chainlink oracles, dispatches payroll execution via HTTP to a backend API.

---

## Issue 1 — `evmClient.logTrigger()` in compiled WASM crashes subscribe phase even when guarded by a runtime flag

**Description:**
Calling `evmClient.logTrigger({addresses, topics})` inside `initWorkflow` causes the simulation to crash during the subscribe phase with exit codes `420 → 54 → 1265`, even when the call is behind a `config.enableLogTrigger === false` runtime guard. The crash happens unconditionally because the WASM binary is compiled from the full TypeScript source — dead code paths are not eliminated by Javy. Any call to `logTrigger` in the compiled binary triggers the crash regardless of whether it is ever reached at runtime.

**Reproduce:**

```typescript
const initWorkflow = (config: Config) => {
  const evmClient = new cre.capabilities.EVMCapability();
  const http = new cre.capabilities.HTTPCapability();

  if (config.enableLogTrigger) {
    // This is never reached when enableLogTrigger=false,
    // but the crash happens anyway during subscribe phase.
    return [
      cre.handler(
        evmClient.logTrigger({
          addresses: [config.triggerContractAddress],
          topics: [],
        }),
        onLogTrigger,
      ),
    ];
  }
  return [cre.handler(http.trigger({}), onHttpTrigger)];
};
```

**Observed:** `cre workflow simulate` exits with code 420 during subscribe, before any user code runs.
**Expected:** A runtime guard should prevent the log trigger from being registered and the simulation should proceed normally.
**Workaround:** Remove all log trigger code from `initWorkflow` entirely when targeting simulation. HTTP trigger only.
**Suggested fix:** Either exclude dead code paths from the WASM compilation step, or document clearly that `logTrigger` cannot coexist with `httpTrigger` in any code path — even unreachable ones — in simulation mode.

---

## Issue 2 — Javy/QuickJS rejects optional chaining (`?.`) and nullish coalescing (`??`) in user code

**Description:**
The CRE CLI compiles TypeScript via Javy (QuickJS engine). QuickJS does not support ES2020 syntax including optional chaining (`?.`) and nullish coalescing (`??`). Any use of these operators in workflow TypeScript source causes a cryptic runtime parse error:

```
unexpected token: '.'
```

This error surfaces during simulation with no reference to the offending file or line number, making it very hard to diagnose. The error message looks identical to a structural problem rather than a syntax limitation.

**Reproduce:**

```typescript
// Any of these lines cause the crash:
const total = emp.splits?.reduce((s, x) => s + x.percent, 0) ?? 0;
const addr = emp.settleAddress ?? defaultAddress;
const name = result?.employeeName;
```

**Observed:** `unexpected token: '.'` at simulation start — no file/line context.
**Expected:** Either a clear error at build time ("optional chaining not supported by the CRE runtime"), or Javy upgraded to support ES2020+.
**Workaround:** Manually rewrite all `?.` and `??` to explicit null checks:

```typescript
const total =
  emp.splits && emp.splits.length > 0
    ? emp.splits.reduce((s: number, x: Split) => s + x.percent, 0)
    : 0;
const addr =
  emp.settleAddress !== null && emp.settleAddress !== undefined
    ? emp.settleAddress
    : defaultAddress;
```

**Suggested fix:** Upgrade Javy to a version that supports ES2020 syntax, or add a pre-compilation step (e.g. via esbuild `target: es2019`) that downtranspiles user code before passing to Javy.

---

## Issue 3 — SDK's bundled Zod library uses `?.` / `??` — cannot be fixed at user level

**Description:**
Even after manually rewriting all user code to avoid `?.` and `??`, the SDK's own bundled `zod` library uses these operators internally. This causes the same `unexpected token: '.'` crash from inside the SDK bundle — something the developer has no ability to fix.

**Observed:** After removing all `?.`/`??` from user code, simulation still crashes with the same error originating from within the SDK bundle.
**Expected:** The SDK bundle should be pre-compiled for the Javy/QuickJS target it runs on.
**Suggested fix:** Ship a QuickJS-compatible build of the SDK (or ship a version of Zod compiled to ES5/ES2019) so user workflows can run without being blocked by SDK internals.

---

## Issue 4 — `--config` path has an undocumented 97-character maximum length

**Description:**
The CRE CLI enforces a maximum of 97 characters on the `--config` flag path. If the absolute path to the config file exceeds this limit (common in deep project structures or long usernames), the CLI silently fails or errors without a clear message about the length constraint.

**Reproduce:**

```bash
# This path is 105 characters — silently rejected:
cre workflow simulate ./my-workflow \
  --config /Users/longusername/projects/payflow-app/cre-workflow/my-workflow/config/config.staging.json \
  --non-interactive
```

**Observed:** CLI fails with an opaque error. No mention of path length in the output.
**Expected:** A clear error: "Config path exceeds 97 character limit. Use a symlink or shorter path."
**Workaround:** Create a symlink in `/tmp` pointing to the real config file:

```bash
ln -s /long/path/to/config.json /tmp/pf-cfg.json
cre workflow simulate ./my-workflow --config /tmp/pf-cfg.json
```

**Suggested fix:** Either remove the path length limit, or emit a clear diagnostic when it is exceeded.

---

## Issue 5 — EVM log trigger implementation: undocumented topic format and indexed-param decoding

**Description:**
The documentation for `evmClient.logTrigger()` does not explain how to compute the event signature (topic[0]) or how to decode indexed Solidity parameters from `EVMLog.topics`. Developers have to reverse-engineer both from the SDK types and Ethereum ABI encoding rules.

**Topic[0] — event signature hash:**
The `topics` filter expects `keccak256` of the canonical event signature string (no parameter names, no spaces). This must be computed externally — the SDK provides no helper:

```typescript
// keccak256("PayrollRequested(address,uint256,address)")
const PAYROLL_REQUESTED_SIG =
  "0xfd3213d1adcbd44eef9d66010322a853c57000751ed8f7098189b1f96ac4dbcd";

const logTrigger = evmClient.logTrigger({
  addresses: [config.triggerContractAddress as `0x${string}`],
  topics: [{ values: [PAYROLL_REQUESTED_SIG] }],
});
```

**Decoding indexed parameters from `EVMLog.topics`:**
Each indexed parameter occupies one 32-byte topic slot (topics[0] = sig, topics[1] = first indexed param, …).
- `indexed address` — left-padded to 32 bytes → extract with `.slice(12)`:
  ```typescript
  const treasury = "0x" + Array.from(log.topics[1].slice(12))
    .map((b: number) => b.toString(16).padStart(2, "0")).join("");
  ```
- `indexed uint256` — full 32-byte big-endian → decode with the SDK's `bytesToBigint`:
  ```typescript
  const depositChainId = Number(bytesToBigint(log.topics[2]));
  ```

Non-indexed parameters land in `log.data` as ABI-encoded bytes and require manual decoding.

**Observed:** Zero documentation on topic structure, event sig format, or how to use `bytesToBigint`/`slice` for topic decoding. The `EVMLog` type exposes raw `Uint8Array[]` topics with no helper methods.
**Expected:** A short guide (or code snippet) in the EVM log trigger docs showing: (a) how to compute the sig hash, (b) how to decode `address`, `uint256`, and `bytes32` from topics.
**Suggested fix:** Add a "Decoding the event payload" section to the EVM log trigger guide with canonical examples for each Solidity type. Alternatively, expose a `decodeTopics(abi, log)` helper in the SDK — similar to viem's `decodeEventLog`.

---

## Issue 6 — `logTrigger` cannot coexist with `httpTrigger` in local simulation even in separate `initWorkflow` branches

**Description:**
Attempting to deploy to the DON requires `logTrigger` in `initWorkflow`. But any build of the workflow that contains a call to `evmClient.logTrigger()` — even inside a dead code branch — crashes `cre workflow simulate` during the subscribe phase (see Issue 1). This forces developers to maintain two separate workflow builds: one for simulation (HTTP only) and one for DON deployment (EVM log trigger).

**Workaround:** Use a build-time environment variable or a separate entrypoint to strip the log trigger before running simulation:

```typescript
// main.ts (DON deployment — enableLogTrigger always true in config.staging.json)
const initWorkflow = (config: Config) => {
  if (config.enableLogTrigger) {
    const evmClient = new cre.capabilities.EVMClient(SEPOLIA);
    const logTrigger = evmClient.logTrigger({
      addresses: [config.triggerContractAddress as `0x${string}`],
      topics: [{ values: [PAYROLL_REQUESTED_SIG] }],
    });
    return [cre.handler(logTrigger, onLogTrigger)];
  }
  const http = new cre.capabilities.HTTPCapability();
  return [cre.handler(http.trigger({}), onHttpTrigger)];
};
```

For local simulation, set `enableLogTrigger: false` in config **and** ensure your build tooling tree-shakes the log trigger branch — otherwise the WASM binary will still include the dead `logTrigger` call and crash.

**Expected:** `cre workflow simulate` should skip trigger registration for trigger types it does not support (e.g. EVM log) and fall through to the next handler, or at minimum fail gracefully with a message like "EVM log triggers are not supported in simulation mode."
**Suggested fix:** Detect unsupported trigger types at the subscribe phase and emit a clear warning/skip rather than an unrecoverable crash.
