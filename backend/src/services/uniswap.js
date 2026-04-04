/**
 * Uniswap Trading API Service — multi-chain
 * Supports same-chain, cross-chain (bridge), and two-hop (bridge + dest swap) via Uniswap Trading API.
 * Chain/token config comes entirely from config/networks.js.
 */
import { ethers } from "ethers";
import { getNetwork, getToken } from "../config/networks.js";

// Pending second-hop swaps: bridgeOrderId → { destQuote, settleAddress, ... }
const pendingSecondHops = new Map();

// Callbacks registered by payroll.js: bridgeTxHash → fn({ secondHopTxHash, transferTxHash })
export const onSecondHopComplete = new Map();

const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";
const UNISWAP_API_KEY  = process.env.UNISWAP_API_KEY || "";
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || "";

function uniswapHeaders() {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...(UNISWAP_API_KEY ? { "x-api-key": UNISWAP_API_KEY } : {}),
  };
}

// Singleton wallet per chain — reusing the same Wallet+Provider instance means
// ethers.js queries the same RPC connection, avoiding nonce lag from stale nodes.
const walletCache = new Map();
function getRelayerWallet(chainId) {
  if (!walletCache.has(chainId)) {
    const net      = getNetwork(chainId);
    const provider = new ethers.JsonRpcProvider(net.rpcUrl);
    walletCache.set(chainId, new ethers.Wallet(RELAYER_PRIVATE_KEY, provider));
  }
  return walletCache.get(chainId);
}

function toTokenUnits(amount, decimals) {
  return BigInt(Math.round(amount * 10 ** decimals)).toString();
}

// Permit2 — same address on all EVM chains
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

async function ensurePermit2Approval(wallet, tokenAddress, amountNeeded) {
  if (!tokenAddress || tokenAddress === "0x0000000000000000000000000000000000000000") return;
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const allowance = await token.allowance(wallet.address, PERMIT2_ADDRESS);
  if (allowance < BigInt(amountNeeded)) {
    console.log(`[Uniswap] Approving Permit2 for ${tokenAddress} on chain ${(await wallet.provider.getNetwork()).chainId}...`);
    const tx = await token.approve(PERMIT2_ADDRESS, ethers.MaxUint256);
    await tx.wait();
    console.log(`[Uniswap] Permit2 approval confirmed: ${tx.hash}`);
  }
}


/**
 * Internal direct quote — does not fall back.
 * @param {string|null} recipient - Output recipient address (same-chain only). If set, the router
 *   sends output tokens directly to this address, skipping a separate relayer→employee transfer.
 */
async function getQuoteDirect(depositCoin, depositChainId, settleCoin, settleChainId, depositAmount) {
  const tokenIn  = getToken(depositCoin, depositChainId);
  const tokenOut = getToken(settleCoin, settleChainId);
  const wallet   = getRelayerWallet(depositChainId);
  const amountIn = toTokenUnits(depositAmount, tokenIn.decimals);
  const isCrossChain = depositChainId !== settleChainId;

  const body = {
    tokenIn:         tokenIn.address,
    tokenOut:        tokenOut.address,
    tokenInChainId:  depositChainId,
    tokenOutChainId: settleChainId,
    type:            "EXACT_INPUT",
    amount:          amountIn,
    swapper:         wallet.address,
    // Include V4 so pools like WBTC@Base (V4-only) are reachable.
    // Cross-chain uses BEST_PRICE (UniswapX bridge routing).
    // Sepolia: V4 pools don't exist — restrict to V2/V3 to avoid reverts.
    // Base Sepolia: V4-only deployment — skip V2/V3.
    ...(isCrossChain
      ? { routingPreference: "BEST_PRICE" }
      : depositChainId === 11155111
      ? { protocols: ["V2", "V3"] }
      : depositChainId === 84532
      ? { protocols: ["V4"] }
      : { protocols: ["V2", "V3", "V4"] }
    ),
  };

  console.log(`[Uniswap] quote ${depositCoin}@${depositChainId} → ${settleCoin}@${settleChainId}:`, JSON.stringify(body));

  // Retry up to 2 times on APIResponseValidationError — WBTC@Base V4 routes are intermittently
  // rejected by the Trading API even with valid params; a brief retry usually succeeds.
  let res, data;
  for (let attempt = 0; attempt <= 2; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
    res  = await fetch(`${UNISWAP_API_BASE}/quote`, {
      method: "POST", headers: uniswapHeaders(), body: JSON.stringify(body),
    });
    data = await res.json();
    if (res.ok || data.errorCode !== "APIResponseValidationError") break;
    console.warn(`[Uniswap] APIResponseValidationError on attempt ${attempt + 1}, retrying...`);
  }
  if (!res.ok) throw new Error(`Uniswap quote error ${res.status}: ${JSON.stringify(data)}`);

  const rawQuote      = data.quote;
  const settleAmount  = Number(rawQuote.output.amount) / 10 ** tokenOut.decimals;
  const rate          = settleAmount / depositAmount;

  return {
    id:             rawQuote.quoteId || data.requestId,
    rate,
    depositAmount,
    settleAmount,
    depositChainId,
    settleChainId,
    isCrossChain,
    routing:        data.routing || rawQuote.routing || "CLASSIC",
    expiresAt:      Date.now() + 30_000,
    rawQuote,
    permitData:     data.permitData || null,
    provider:       "uniswap",
  };
}

/**
 * Public quote entry point.
 * Tries a direct route first. For cross-chain swaps where the settle coin differs
 * from the deposit coin and no direct route exists, falls back to a two-hop:
 *   1. Bridge depositCoin → depositCoin on settleChain (BRIDGE routing)
 *   2. Same-chain swap depositCoin → settleCoin on settleChain (CLASSIC routing)
 */
export async function getQuote(depositCoin, depositChainId, settleCoin, settleChainId, depositAmount) {
  const isCrossChain = depositChainId !== settleChainId;
  const isSameAsset  = depositCoin.toLowerCase() === settleCoin.toLowerCase();

  // Same chain + same asset = direct transfer, no swap needed
  if (!isCrossChain && isSameAsset) {
    const token = getToken(depositCoin, depositChainId);
    const units = toTokenUnits(depositAmount, token.decimals);
    return {
      id:             ethers.keccak256(ethers.toUtf8Bytes(`direct_${depositCoin}_${depositChainId}_${Date.now()}`)),
      rate:           1,
      depositAmount,
      settleAmount:   depositAmount,
      depositChainId,
      settleChainId,
      isCrossChain:   false,
      isTwoHop:       false,
      routing:        "DIRECT",
      depositCoin:    depositCoin.toLowerCase(),
      expiresAt:      Date.now() + 30_000,
      rawQuote: {
        input:  { token: token.address, amount: units },
        output: { token: token.address, amount: units },
      },
      provider: "direct",
    };
  }

  // Cross-chain same-asset: bridge to dest chain then direct transfer to employee
  if (isCrossChain && isSameAsset) {
    console.log("[Uniswap] Cross-chain same-asset — routing through two-hop bridge+direct...");
    return await getQuoteTwoHop(depositCoin, depositChainId, settleCoin, settleChainId, depositAmount);
  }

  try {
    return await getQuoteDirect(depositCoin, depositChainId, settleCoin, settleChainId, depositAmount);
  } catch (err) {
    if (isCrossChain && err.message.includes("No quotes available")) {
      console.log("[Uniswap] No direct cross-chain route — falling back to two-hop bridge+swap...");
      return await getQuoteTwoHop(depositCoin, depositChainId, settleCoin, settleChainId, depositAmount);
    }
    throw err;
  }
}

/**
 * Two-hop quote: bridge depositCoin to dest chain, then swap to settleCoin on dest chain.
 * Returns a combined quote with isTwoHop=true and the second-leg quote nested inside.
 */
async function getQuoteTwoHop(depositCoin, depositChainId, settleCoin, settleChainId, depositAmount) {
  const bridgeQuote   = await getQuoteDirect(depositCoin, depositChainId, depositCoin, settleChainId, depositAmount);
  const destSwapQuote = await getQuote(depositCoin, settleChainId, settleCoin, settleChainId, bridgeQuote.settleAmount);

  console.log(`[Uniswap] Two-hop: bridge rate=${bridgeQuote.rate.toFixed(6)}, dest swap rate=${destSwapQuote.rate.toFixed(8)}`);

  return {
    ...bridgeQuote,
    isTwoHop:     true,
    settleAmount: destSwapQuote.settleAmount,
    rate:         destSwapQuote.settleAmount / depositAmount,
    destSwapQuote,
    provider:     "uniswap_2hop",
  };
}

/**
 * Execute a Uniswap swap.
 * 1. Ensure Permit2 approval for input token on source chain
 * 2. Sign Permit2 permit if required
 * 3. Get calldata from /v1/swap
 * 4. Broadcast on source chain
 * 5. Transfer output tokens to employee (same-chain only — cross-chain delivery is automatic)
 */
/**
 * Execute a UniswapX cross-chain order.
 * Signs the order and submits to the UniswapX order service (no on-chain tx from relayer).
 */
async function executeUniswapXOrder(quote) {
  const wallet = getRelayerWallet(quote.depositChainId);
  const net    = getNetwork(quote.depositChainId);

  const tokenInAddress = quote.rawQuote.input?.token ?? quote.rawQuote.tokenIn;
  const amountIn       = quote.rawQuote.input?.amount ?? quote.rawQuote.amountIn;

  // Approve Permit2 on the source chain for the input token
  await ensurePermit2Approval(wallet, tokenInAddress, amountIn);

  // Build the signed order via /swap
  const swapRes = await fetch(`${UNISWAP_API_BASE}/swap`, {
    method: "POST",
    headers: uniswapHeaders(),
    body: JSON.stringify({ quote: quote.rawQuote, simulateTransaction: false }),
  });
  const swapData = await swapRes.json();
  if (!swapRes.ok) throw new Error(`UniswapX order build error ${swapRes.status}: ${JSON.stringify(swapData)}`);


  // New Trading API format: signature is returned by the API directly (server-side signing).
  // Old format: permitData is returned and we must sign it ourselves.
  let signature;
  const permitData = swapData.permitData ?? quote.permitData;
  if (swapData.signature) {
    // API already signed — use it directly
    signature = swapData.signature;
    console.log(`[UniswapX] Using API-provided signature`);
  } else if (permitData?.domain && permitData?.types && permitData?.values) {
    signature = await wallet.signTypedData(permitData.domain, permitData.types, permitData.values);
    console.log(`[UniswapX] Self-signed permit`);
  } else {
    throw new Error("UniswapX order: no permit data or signature in swap response");
  }

  const encodedOrder = swapData.swap?.encodedOrder ?? swapData.encodedOrder;

  // BRIDGE routing returns on-chain calldata (to/data/value), not a UniswapX order.
  // Broadcast it directly — the bridge contract handles cross-chain delivery to the swapper.
  if (!encodedOrder && swapData.swap?.data) {
    const txData = swapData.swap;
    // Bridge contracts need a direct ERC20 approval (not just Permit2).
    // Approve the bridge contract (txData.to) for the input token.
    if (tokenInAddress && tokenInAddress !== "0x0000000000000000000000000000000000000000") {
      const token = new ethers.Contract(tokenInAddress, ERC20_ABI, wallet);
      const allowance = await token.allowance(wallet.address, txData.to);
      if (allowance < BigInt(amountIn)) {
        console.log(`[UniswapX] Approving bridge contract ${txData.to} for ${tokenInAddress}...`);
        const approveTx = await token.approve(txData.to, ethers.MaxUint256);
        await approveTx.wait();
        console.log(`[UniswapX] Bridge approval confirmed: ${approveTx.hash}`);
      }
    }
    console.log(`[UniswapX] Bridge calldata detected — broadcasting on ${net.name}...`);
    const tx = await wallet.sendTransaction({
      to:       txData.to,
      data:     txData.data,
      value:    txData.value   ? BigInt(txData.value)   : 0n,
      gasLimit: txData.gasLimit ? BigInt(txData.gasLimit) : undefined,
      chainId:  quote.depositChainId,
    });
    console.log(`[UniswapX] Bridge tx broadcast: ${tx.hash}`);
    await tx.wait();
    console.log(`[UniswapX] Bridge tx confirmed: ${tx.hash}`);
    return {
      id:             tx.hash,
      depositAddress: wallet.address,
      status:         "processing",
      txHash:         tx.hash,
      transferTxHash: null,
      explorerUrl:    `${net.explorer}/tx/${tx.hash}`,
      provider:       "bridge",
      isCrossChain:   true,
      depositChainId: quote.depositChainId,
      settleChainId:  quote.settleChainId,
    };
  }

  if (!encodedOrder) {
    throw new Error(`UniswapX order: no encodedOrder in swap response. Keys: ${Object.keys(swapData.swap ?? swapData).join(", ")}`);
  }

  // Submit the UniswapX signed order
  const orderRes = await fetch(`${UNISWAP_API_BASE}/order`, {
    method: "POST",
    headers: uniswapHeaders(),
    body: JSON.stringify({
      encodedOrder,
      signature,
      chainId: quote.depositChainId,
      quoteId: quote.id,
    }),
  });
  const orderData = await orderRes.json();
  if (!orderRes.ok) throw new Error(`UniswapX order submit error ${orderRes.status}: ${JSON.stringify(orderData)}`);

  const orderId = orderData.hash ?? orderData.orderId ?? orderData.orderHash ?? quote.id;
  console.log(`[UniswapX] cross-chain order submitted: ${orderId}`);

  return {
    id:             orderId,
    depositAddress: wallet.address,
    status:         "processing",
    txHash:         orderId,
    transferTxHash: null,
    explorerUrl:    `${net.explorer}`,
    provider:       "uniswap_x",
    isCrossChain:   true,
    depositChainId: quote.depositChainId,
    settleChainId:  quote.settleChainId,
  };
}

/**
 * Two-hop execution:
 * 1. Snapshot relayer USDC balance on dest chain.
 * 2. Execute bridge (source chain → dest chain, USDC → USDC).
 * 3. Poll relayer USDC balance on dest chain; when it increases by expectedAmount, execute second hop.
 */
async function executeTwoHopSwap(quote, settleAddress) {
  const destChainId   = quote.settleChainId;
  const destWallet    = getRelayerWallet(destChainId);
  const destUsdcAddr  = quote.destSwapQuote.rawQuote.input?.token ?? quote.destSwapQuote.rawQuote.tokenIn;
  const expectedUnits = BigInt(quote.destSwapQuote.rawQuote.input?.amount ?? quote.destSwapQuote.rawQuote.amountIn ?? "0");

  // Snapshot USDC balance on dest chain before bridge
  const destToken    = new ethers.Contract(destUsdcAddr, ERC20_ABI, destWallet);
  const balanceBefore = await destToken.balanceOf(destWallet.address);
  console.log(`[TwoHop] Relayer USDC on Base before bridge: ${balanceBefore}`);

  const bridgeResult = await executeUniswapXOrder(
    { ...quote, isTwoHop: false },
    settleAddress,
  );

  // Store params needed to re-quote at execution time (original quote will be stale by then)
  pendingSecondHops.set(bridgeResult.id, {
    depositCoin:  "usdc",           // always USDC bridged to dest chain
    settleCoin:   quote.destSwapQuote.rawQuote.output?.token
                    ? Object.entries(getNetwork(destChainId).tokens)
                        .find(([, t]) => t.address.toLowerCase() === quote.destSwapQuote.rawQuote.output.token.toLowerCase())?.[0]
                        ?? "eth"
                    : "eth",
    settleAddress,
    destChainId,
    destUsdcAddr,
    expectedUnits,
    balanceBefore,
  });

  scheduleBridgePoll(bridgeResult.id);

  console.log(`[TwoHop] Bridge tx confirmed: ${bridgeResult.txHash} — polling Base for USDC arrival (need ${expectedUnits})`);
  return { ...bridgeResult, isTwoHop: true, provider: "uniswap_2hop" };
}

/**
 * Poll relayer USDC balance on destination chain.
 * When balance increases by expectedUnits, execute the second-leg same-chain swap.
 */
function scheduleBridgePoll(orderId) {
  let attempts = 0;
  const MAX_ATTEMPTS = 80;  // ~20 min at 15s intervals
  const INTERVAL     = 15_000;

  const poll = async () => {
    if (++attempts > MAX_ATTEMPTS || !pendingSecondHops.has(orderId)) return;

    const hop = pendingSecondHops.get(orderId);
    try {
      const destWallet  = getRelayerWallet(hop.destChainId);
      const destToken   = new ethers.Contract(hop.destUsdcAddr, ERC20_ABI, destWallet);
      const balanceNow  = await destToken.balanceOf(destWallet.address);
      const received    = balanceNow - hop.balanceBefore;

      console.log(`[TwoHop] Base USDC balance: ${balanceNow} (received: ${received}, need: ${hop.expectedUnits}) attempt ${attempts}`);

      if (received >= hop.expectedUnits * 95n / 100n) {  // allow 5% slippage on bridge
        pendingSecondHops.delete(orderId);
        console.log("[TwoHop] USDC arrived on Base — fetching fresh quote for second hop...");
        try {
          // Re-quote with actual received amount, capped at this employee's expected share.
          // Multiple bridges can arrive in the same poll tick — without the cap the first
          // second-hop would consume all accumulated USDC, leaving nothing for the others.
          const received      = balanceNow - hop.balanceBefore;
          const toSwap        = received > hop.expectedUnits ? hop.expectedUnits : received;
          const receivedHuman = Number(toSwap) / 1_000_000; // USDC has 6 decimals
          const freshQuote = await getQuote(hop.depositCoin, hop.destChainId, hop.settleCoin, hop.destChainId, receivedHuman);
          console.log(`[TwoHop] Fresh second-hop quote: ${receivedHuman} USDC → ${freshQuote.settleAmount} ${hop.settleCoin.toUpperCase()}`);
          const swap = await executeSwap(freshQuote, hop.settleAddress);
          console.log(`[TwoHop] Second hop complete: ${swap.txHash}`);
          const cb = onSecondHopComplete.get(orderId);
          if (cb) {
            cb({ secondHopTxHash: swap.txHash, transferTxHash: swap.transferTxHash ?? swap.txHash ?? null, error: null });
            onSecondHopComplete.delete(orderId);
          }
        } catch (e) {
          console.error("[TwoHop] Second hop failed:", e.message);
          const raw = e.message ?? "";
          const msg = raw.includes("INSUFFICIENT_FUNDS") || raw.includes("insufficient funds")
            ? "Relayer has no ETH on Base for gas — top up and retry"
            : raw.includes("execution reverted") || raw.includes("CALL_EXCEPTION")
            ? "Swap on Base reverted — check relayer balance and retry"
            : raw.split("\n")[0].slice(0, 80);
          const cb = onSecondHopComplete.get(orderId);
          if (cb) {
            cb({ secondHopTxHash: null, transferTxHash: null, error: msg });
            onSecondHopComplete.delete(orderId);
          }
        }
        return;
      }
    } catch (e) {
      console.warn("[TwoHop] Poll error:", e.message);
    }

    setTimeout(poll, INTERVAL);
  };

  setTimeout(poll, INTERVAL);
}

export async function executeSwap(quote, settleAddress) {
  // Two-hop: bridge + dest swap
  if (quote.isTwoHop) {
    return executeTwoHopSwap(quote, settleAddress);
  }

  // Direct transfer: same chain + same asset, no swap
  if (quote.routing === "DIRECT") {
    return directTransfer(quote.depositCoin, quote.depositChainId, quote.depositAmount, settleAddress);
  }

  // Cross-chain quotes go through UniswapX order submission, not on-chain calldata
  if (quote.routing && quote.routing !== "CLASSIC") {
    return executeUniswapXOrder(quote);
  }

  const wallet = getRelayerWallet(quote.depositChainId);
  const net    = getNetwork(quote.depositChainId);

  const tokenInAddress  = quote.rawQuote.input.token;
  const tokenOutAddress = quote.rawQuote.output.token;
  const amountIn        = quote.rawQuote.input.amount;

  await ensurePermit2Approval(wallet, tokenInAddress, amountIn);

  let permitSignature = null;
  if (quote.permitData) {
    const { domain, types, values } = quote.permitData;
    permitSignature = await wallet.signTypedData(domain, types, values);
  }

  const swapBody = {
    quote: quote.rawQuote,
    ...(permitSignature ? { permitData: quote.permitData, signature: permitSignature } : {}),
    simulateTransaction: false,
  };

  const res  = await fetch(`${UNISWAP_API_BASE}/swap`, {
    method: "POST", headers: uniswapHeaders(), body: JSON.stringify(swapBody),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Uniswap swap error ${res.status}: ${JSON.stringify(data)}`);

  const txData = data.swap ?? data;
  if (!txData.data || txData.data === "0x" || txData.data === "") {
    throw new Error(
      "Uniswap returned empty calldata (UniswapX off-chain order) — " +
      "no on-chain V2/V3 route available for this pair/amount. " +
      "Try a different asset or amount."
    );
  }

  // Some Uniswap router contracts on Base/Arbitrum need a direct ERC20 approval
  // in addition to Permit2, depending on the route chosen.
  if (tokenInAddress && tokenInAddress !== "0x0000000000000000000000000000000000000000" && txData.to) {
    const token = new ethers.Contract(tokenInAddress, ERC20_ABI, wallet);
    const allowance = await token.allowance(wallet.address, txData.to);
    if (allowance < BigInt(amountIn)) {
      console.log(`[Uniswap] Approving router ${txData.to} for ${tokenInAddress} on chain ${quote.depositChainId}...`);
      const approveTx = await token.approve(txData.to, ethers.MaxUint256);
      await approveTx.wait();
      console.log(`[Uniswap] Router approval confirmed: ${approveTx.hash}`);
    }
  }

  const tx = await wallet.sendTransaction({
    to:                   txData.to,
    data:                 txData.data,
    value:                txData.value ? BigInt(txData.value) : 0n,
    gasLimit:             txData.gasLimit             ? BigInt(txData.gasLimit)             : undefined,
    maxFeePerGas:         txData.maxFeePerGas         ? BigInt(txData.maxFeePerGas)         : undefined,
    maxPriorityFeePerGas: txData.maxPriorityFeePerGas ? BigInt(txData.maxPriorityFeePerGas) : undefined,
    chainId:              quote.depositChainId,
  });

  console.log(`[Uniswap] swap tx broadcast on ${net.name}: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`[Uniswap] swap confirmed: ${receipt.hash}`);

  // For same-chain swaps: deliver output tokens to the employee.
  // Parse Transfer events from the receipt to find where the router actually sent the tokens —
  // this is reliable regardless of RPC caching or router recipient encoding.
  let transferTxHash = null;
  if (!quote.isCrossChain &&
      tokenOutAddress &&
      tokenOutAddress !== "0x0000000000000000000000000000000000000000" &&
      settleAddress.toLowerCase() !== wallet.address.toLowerCase()) {

    const transferIface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
    let toRelayerAmount   = 0n;
    let fromRelayerAmount = 0n;
    let toEmployeeDirect  = false;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== tokenOutAddress.toLowerCase()) continue;
      try {
        const parsed = transferIface.parseLog(log);
        const from = parsed.args[0].toLowerCase();
        const to   = parsed.args[1].toLowerCase();
        if (to === settleAddress.toLowerCase()) {
          toEmployeeDirect = true;
          break;
        }
        if (to === wallet.address.toLowerCase())   toRelayerAmount   += parsed.args[2];
        if (from === wallet.address.toLowerCase()) fromRelayerAmount += parsed.args[2];
      } catch { /* not a Transfer event */ }
    }

    // Net amount received by relayer. Subtracting fromRelayerAmount handles multi-hop
    // routes where the output token passes through the relayer as an intermediate step,
    // which would otherwise inflate toRelayerAmount beyond what we actually hold.
    const netRelayerAmount = toRelayerAmount - fromRelayerAmount;

    if (toEmployeeDirect) {
      // Router already sent tokens directly to employee in the swap tx
      transferTxHash = tx.hash;
      console.log(`[Uniswap] Output went directly to ${settleAddress} in swap tx — no separate transfer needed`);
    } else {
      // Verify actual relayer balance — Transfer event parsing can miss direct-to-employee
      // routes (e.g. UniswapX), causing netRelayerAmount to be non-zero even when the
      // relayer received nothing. Clamping to actual balance prevents a reverted transfer.
      const erc20         = new ethers.Contract(tokenOutAddress, ERC20_ABI, wallet);
      const actualBalance = await erc20.balanceOf(wallet.address);
      const sendAmount    = actualBalance < netRelayerAmount ? actualBalance : netRelayerAmount;

      if (sendAmount === 0n) {
        // Tokens went directly to employee or elsewhere — swap tx is the delivery proof
        transferTxHash = tx.hash;
        console.log(`[Uniswap] Relayer balance is 0 — tokens already delivered in swap tx, no transfer needed`);
      } else {
        // Tokens landed in relayer — forward to employee.
        // Derive nonce from the swap tx to avoid RPC cache lag.
        const nonce = tx.nonce + 1;
        // Retry on "in-flight transaction limit reached" — Base public RPC throttles
        // accounts with multiple pending txs; a short wait usually clears it.
        let transferTx;
        for (let attempt = 0; attempt <= 3; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 3000 * attempt));
          try {
            transferTx = await erc20.transfer(settleAddress, sendAmount, { nonce });
            break;
          } catch (transferErr) {
            const msg = transferErr?.message ?? "";
            if (attempt < 3 && msg.includes("in-flight transaction limit")) {
              console.warn(`[Uniswap] in-flight limit on transfer attempt ${attempt + 1}, retrying...`);
            } else {
              throw transferErr;
            }
          }
        }
        await transferTx.wait();
        transferTxHash = transferTx.hash;
        console.log(`[Uniswap] transferred ${sendAmount} of ${tokenOutAddress} to ${settleAddress}: ${transferTx.hash}`);
      }
    }
  }

  return {
    id:             tx.hash,
    depositAddress: wallet.address,
    status:         "processing",
    txHash:         tx.hash,
    transferTxHash,
    explorerUrl:    `${net.explorer}/tx/${tx.hash}`,
    provider:       "uniswap",
    isCrossChain:   quote.isCrossChain,
    depositChainId: quote.depositChainId,
    settleChainId:  quote.settleChainId,
  };
}

/**
 * Direct ERC20 transfer — used for same-asset, same-chain payments (no swap needed)
 */
async function directTransfer(coin, chainId, amount, toAddress) {
  const token  = getToken(coin, chainId);
  const wallet = getRelayerWallet(chainId);
  const erc20  = new ethers.Contract(token.address, ERC20_ABI, wallet);
  const units  = toTokenUnits(amount, token.decimals);
  const tx     = await erc20.transfer(toAddress, units);
  console.log(`[Uniswap] direct transfer ${amount} ${coin} to ${toAddress}: ${tx.hash}`);
  return {
    id:             tx.hash,
    depositAddress: wallet.address,
    status:         "processing",
    txHash:         tx.hash,
    provider:       "direct",
    explorerUrl:    `${getNetwork(chainId).explorer}/tx/${tx.hash}`,
  };
}

/**
 * Check swap status by tx hash on any supported chain
 */
export async function getSwapStatus(txHash, chainId) {
  try {
    const net      = getNetwork(chainId);
    const provider = new ethers.JsonRpcProvider(net.rpcUrl);
    const receipt  = await provider.getTransactionReceipt(txHash);
    if (!receipt) return { status: "processing", txHash, chainId, provider: "uniswap" };
    return {
      status:      receipt.status === 1 ? "settled" : "failed",
      txHash,
      chainId,
      explorerUrl: `${net.explorer}/tx/${txHash}`,
      provider:    "uniswap",
    };
  } catch {
    return { status: "processing", txHash, chainId, provider: "uniswap" };
  }
}
