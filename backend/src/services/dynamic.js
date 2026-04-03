/**
 * Dynamic / relayer wallet service
 * Handles relayer signing and treasury pulls for any ERC-20 asset.
 */
import { ethers } from "ethers";

import { getToken, getNetwork } from "../config/networks.js";


const ERC20_ABI = [
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

/**
 * Pull any ERC-20 asset from a company wallet into the relayer using transferFrom.
 * @param {string} asset  - token symbol (e.g. "usdc", "eth", "usdt")
 * @param {string} companyAddress
 * @param {number} amount - human-readable units (e.g. 3000 for 3000 USDC, 1.5 for 1.5 ETH)
 * @param {number} chainId
 */
export async function pullFromTreasury(asset, companyAddress, amount, chainId = 11155111) {
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  if (!relayerKey) throw new Error("RELAYER_PRIVATE_KEY not set");

  const net           = getNetwork(chainId);
  const token         = getToken(asset, chainId);
  const chainProvider = new ethers.JsonRpcProvider(net.rpcUrl);
  const relayerWallet = new ethers.Wallet(relayerKey, chainProvider);
  const contract      = new ethers.Contract(token.address, ERC20_ABI, relayerWallet);

  const rawAmount = BigInt(Math.ceil(amount * 10 ** token.decimals));

  const allowance = await contract.allowance(companyAddress, relayerWallet.address);
  if (allowance < rawAmount) {
    throw new Error(
      `Insufficient ${token.symbol} allowance. Company wallet ${companyAddress} must approve at least ${amount} ${token.symbol} to relayer ${relayerWallet.address} on ${net.name}.`
    );
  }

  console.log(`[Treasury] Pulling ${amount} ${token.symbol} from ${companyAddress} on ${net.name}...`);
  const tx      = await contract.transferFrom(companyAddress, relayerWallet.address, rawAmount);
  const receipt = await tx.wait();
  console.log(`[Treasury] Pull confirmed: ${receipt.hash}`);
  return receipt.hash;
}

/**
 * Send ERC-20 tokens from the relayer wallet to a target address.
 * Used to fund SideShift deposit addresses after treasury pull.
 */
export async function sendFromRelayer(asset, toAddress, amount, chainId) {
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  if (!relayerKey) throw new Error("RELAYER_PRIVATE_KEY not set");

  const net           = getNetwork(chainId);
  const token         = getToken(asset, chainId);
  const chainProvider = new ethers.JsonRpcProvider(net.rpcUrl);
  const relayerWallet = new ethers.Wallet(relayerKey, chainProvider);
  const contract      = new ethers.Contract(token.address, ERC20_ABI, relayerWallet);

  const rawAmount = BigInt(Math.ceil(amount * 10 ** token.decimals));
  console.log(`[Relayer] Sending ${amount} ${token.symbol} to ${toAddress} on ${net.name}...`);
  const tx      = await contract.transfer(toAddress, rawAmount);
  const receipt = await tx.wait();
  console.log(`[Relayer] Transfer confirmed: ${receipt.hash}`);
  return receipt.hash;
}

/**
 * Return the relayer's address (so frontend knows where to approve).
 */
let _relayerAddress = null;
export function getRelayerAddress() {
  if (_relayerAddress) return _relayerAddress;
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  if (!relayerKey) throw new Error("RELAYER_PRIVATE_KEY not set");
  _relayerAddress = new ethers.Wallet(relayerKey).address;
  return _relayerAddress;
}

/**
 * Get the treasury balance of any ERC-20 asset for a wallet.
 * @param {string} asset   - token symbol (e.g. "usdc", "eth")
 * @param {string} address
 * @param {number} chainId
 */
export async function getTreasuryBalance(asset, address, chainId = 11155111) {
  try {
    const net           = getNetwork(chainId);
    const token         = getToken(asset, chainId);
    const chainProvider = new ethers.JsonRpcProvider(net.rpcUrl);
    const contract      = new ethers.Contract(token.address, ERC20_ABI, chainProvider);
    const balance       = await contract.balanceOf(address);
    return (Number(balance) / 10 ** token.decimals).toFixed(6);
  } catch (err) {
    console.error(`[Treasury] Balance fetch failed for ${asset}@${chainId}:`, err.message);
    return "0.000000";
  }
}


