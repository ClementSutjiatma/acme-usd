import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  keccak256,
  toBytes,
  type Hash,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempo } from "tempo.ts/chains";
import { config } from "./config";
import { TIP20_ABI, ISSUER_ROLE } from "./contracts";

// TIP-20 decimals
const DECIMALS = 6;

// RPC timeout and retry configuration
// Tempo finalizes quickly, so 15s timeout with 2 retries should be plenty
const RPC_TIMEOUT = 15_000; // 15 seconds
const RPC_RETRY_COUNT = 2;
const RPC_RETRY_DELAY = 500; // 500ms base delay

// Tempo chain with AlphaUSD as fee token
const tempoChain = tempo({ feeToken: config.alphaUsdAddress });

// Create authenticated HTTP transport with timeout and retry config
function createAuthenticatedTransport() {
  const fetchOptions = config.tempoRpcAuth
    ? {
        headers: {
          Authorization: `Basic ${config.tempoRpcAuth}`,
        },
      }
    : undefined;

  return http(config.tempoRpcBaseUrl, {
    fetchOptions,
    timeout: RPC_TIMEOUT,
    retryCount: RPC_RETRY_COUNT,
    retryDelay: RPC_RETRY_DELAY,
  });
}

// Create public client for reading blockchain state
export function createTempoPublicClient() {
  return createPublicClient({
    chain: tempoChain,
    transport: createAuthenticatedTransport(),
  });
}

// Create wallet client for the backend (mint/burn operations)
export function createTempoWalletClient() {
  if (!config.backendPrivateKey) {
    throw new Error("Backend private key not configured");
  }

  const account = privateKeyToAccount(config.backendPrivateKey);

  return createWalletClient({
    account,
    chain: tempoChain,
    transport: createAuthenticatedTransport(),
  });
}

// Get backend wallet address
export function getBackendAddress(): Address {
  if (!config.backendPrivateKey) {
    throw new Error("Backend private key not configured");
  }
  const account = privateKeyToAccount(config.backendPrivateKey);
  return account.address;
}

// Get AcmeUSD balance for an address (returns amount in USD as number)
export async function getAcmeUsdBalance(address: Address): Promise<number> {
  if (!config.acmeUsdAddress) {
    throw new Error("AcmeUSD address not configured");
  }

  const client = createTempoPublicClient();

  const balance = await client.readContract({
    address: config.acmeUsdAddress,
    abi: TIP20_ABI,
    functionName: "balanceOf",
    args: [address],
  });

  // Convert from raw units (6 decimals) to USD number
  return parseFloat(formatUnits(balance as bigint, DECIMALS));
}

// Check if an error is a timeout error
function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('timeout') || message.includes('timed out');
  }
  return false;
}

// Mint AcmeUSD to a user address with timeout recovery
// If a timeout occurs, verifies on-chain balance to determine if mint succeeded
// Uses mintWithMemo to store payment reference on-chain for auditability
export async function mintAcmeUsd(
  toAddress: Address,
  amountUsd: number, // Amount in dollars (e.g., 100 for $100)
  paymentReference?: string // Optional payment reference (e.g., Stripe payment_intent_id) for on-chain auditability
): Promise<Hash> {
  if (!config.acmeUsdAddress) {
    throw new Error("AcmeUSD address not configured");
  }

  const walletClient = createTempoWalletClient();
  const publicClient = createTempoPublicClient();
  const amount = parseUnits(amountUsd.toString(), DECIMALS);

  // Generate memo from payment reference for on-chain auditability
  // This allows anyone to verify which payment caused which mint
  const memo = paymentReference ? keccak256(toBytes(paymentReference)) : undefined;

  console.log(`[MINT] Using RPC: ${config.tempoRpcBaseUrl}, Auth: ${!!config.tempoRpcAuth}`);
  console.log(`[MINT] Minting ${amountUsd} AcmeUSD to ${toAddress}${memo ? ` with memo ${memo}` : ""}`);

  // Check balance before mint for verification
  let balanceBefore: number;
  try {
    balanceBefore = await getAcmeUsdBalance(toAddress);
    console.log(`[MINT] Balance before: ${balanceBefore} AcmeUSD`);
  } catch (balanceError) {
    console.warn(`[MINT] Could not get balance before mint, proceeding without verification`);
    balanceBefore = -1; // Flag that we couldn't get initial balance
  }

  try {
    // Use mintWithMemo if we have a payment reference, otherwise use regular mint
    const hash = memo
      ? await walletClient.writeContract({
          address: config.acmeUsdAddress,
          abi: TIP20_ABI,
          functionName: "mintWithMemo",
          args: [toAddress, amount, memo],
        })
      : await walletClient.writeContract({
          address: config.acmeUsdAddress,
          abi: TIP20_ABI,
          functionName: "mint",
          args: [toAddress, amount],
        });

    // Wait for transaction to be confirmed
    await publicClient.waitForTransactionReceipt({ hash });

    console.log(`[MINT] Minted successfully. TX: ${hash}`);
    return hash;
  } catch (error) {
    console.error(`[MINT] Error during mint:`, error);

    // If we have a baseline balance and got a timeout, verify on-chain state
    if (balanceBefore >= 0 && isTimeoutError(error)) {
      console.log(`[MINT] Timeout detected, verifying on-chain balance...`);
      
      // Wait a moment for any pending transaction to finalize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      try {
        const balanceAfter = await getAcmeUsdBalance(toAddress);
        const expectedIncrease = amountUsd;
        const actualIncrease = balanceAfter - balanceBefore;
        
        console.log(`[MINT] Balance after: ${balanceAfter} AcmeUSD (increase: ${actualIncrease})`);
        
        // Allow for small floating point differences
        if (actualIncrease >= expectedIncrease - 0.01) {
          console.log(`[MINT] Balance verification SUCCESS - mint completed despite timeout`);
          // Return a placeholder hash since we don't have the actual one
          // The important thing is the mint succeeded
          return `0x${'0'.repeat(64)}` as Hash;
        } else {
          console.log(`[MINT] Balance verification FAILED - mint did not complete`);
        }
      } catch (verifyError) {
        console.error(`[MINT] Could not verify balance after timeout:`, verifyError);
      }
    }

    // Re-throw the original error if we couldn't verify success
    throw error;
  }
}

// Burn AcmeUSD from treasury
// Uses burnWithMemo to store offramp reference on-chain for auditability
export async function burnAcmeUsd(
  amountUsd: number, // Amount in dollars
  offrampReference?: string // Optional offramp reference (e.g., offramp request ID) for on-chain auditability
): Promise<Hash> {
  if (!config.acmeUsdAddress) {
    throw new Error("AcmeUSD address not configured");
  }

  const walletClient = createTempoWalletClient();
  const publicClient = createTempoPublicClient();
  const amount = parseUnits(amountUsd.toString(), DECIMALS);

  // Generate memo from offramp reference for on-chain auditability
  const memo = offrampReference ? keccak256(toBytes(offrampReference)) : undefined;

  console.log(`[BURN] Burning ${amountUsd} AcmeUSD from treasury${memo ? ` with memo ${memo}` : ""}`);

  // Use burnWithMemo if we have an offramp reference, otherwise use regular burn
  const hash = memo
    ? await walletClient.writeContract({
        address: config.acmeUsdAddress,
        abi: TIP20_ABI,
        functionName: "burnWithMemo",
        args: [amount, memo],
      })
    : await walletClient.writeContract({
        address: config.acmeUsdAddress,
        abi: TIP20_ABI,
        functionName: "burn",
        args: [amount],
      });

  // Wait for transaction to be confirmed
  await publicClient.waitForTransactionReceipt({ hash });

  console.log(`[BURN] Burned successfully. TX: ${hash}`);
  return hash;
}

// Generate memo hash for offramp
export function generateMemo(requestId: string): `0x${string}` {
  return keccak256(toBytes(requestId));
}

// Check if backend has ISSUER_ROLE on AcmeUSD
export async function hasIssuerRole(): Promise<boolean> {
  if (!config.acmeUsdAddress) {
    return false;
  }

  const client = createTempoPublicClient();
  const backendAddress = getBackendAddress();

  const hasRole = await client.readContract({
    address: config.acmeUsdAddress,
    abi: TIP20_ABI,
    functionName: "hasRole",
    args: [ISSUER_ROLE as `0x${string}`, backendAddress],
  });

  return hasRole as boolean;
}

// Fund address via testnet faucet
export async function fundAddress(address: Address): Promise<void> {
  const client = createTempoPublicClient();

  await client.request({
    method: "tempo_fundAddress" as any,
    params: [address],
  });

  console.log(`[FAUCET] Funded ${address} with testnet tokens`);
}

// Watch for TransferWithMemo events to treasury
// Note: RPC has a 100,000 block range limit, so we query recent blocks only
export async function getTransfersToTreasury(
  blocksToSearch: bigint = BigInt(1000)
): Promise<
  Array<{
    from: Address;
    to: Address;
    value: bigint;
    memo: `0x${string}`;
    transactionHash: Hash;
    blockNumber: bigint;
  }>
> {
  if (!config.acmeUsdAddress || !config.treasuryAddress) {
    return [];
  }

  const client = createTempoPublicClient();

  // Get current block number and calculate fromBlock
  const currentBlock = await client.getBlockNumber();
  const fromBlock = currentBlock > blocksToSearch ? currentBlock - blocksToSearch : BigInt(0);

  console.log(`[TRANSFER] Searching for transfers from block ${fromBlock} to ${currentBlock}`);

  const logs = await client.getLogs({
    address: config.acmeUsdAddress,
    event: {
      type: "event",
      name: "TransferWithMemo",
      inputs: [
        { name: "from", type: "address", indexed: true },
        { name: "to", type: "address", indexed: true },
        { name: "value", type: "uint256", indexed: false },
        { name: "memo", type: "bytes32", indexed: false },
      ],
    },
    args: {
      to: config.treasuryAddress,
    },
    fromBlock,
    toBlock: "latest",
  });

  return logs.map((log) => ({
    from: log.args.from as Address,
    to: log.args.to as Address,
    value: log.args.value as bigint,
    memo: log.args.memo as `0x${string}`,
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber,
  }));
}
