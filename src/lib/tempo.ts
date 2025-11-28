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

// Tempo chain with AlphaUSD as fee token
const tempoChain = tempo({ feeToken: config.alphaUsdAddress });

// Create authenticated HTTP transport
function createAuthenticatedTransport() {
  const fetchOptions = config.tempoRpcAuth
    ? {
        headers: {
          Authorization: `Basic ${config.tempoRpcAuth}`,
        },
      }
    : undefined;

  return http(config.tempoRpcBaseUrl, { fetchOptions });
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

// Get AcmeUSD balance for an address
export async function getAcmeUsdBalance(address: Address): Promise<string> {
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

  return formatUnits(balance as bigint, DECIMALS);
}

// Mint AcmeUSD to a user address
export async function mintAcmeUsd(
  toAddress: Address,
  amountUsd: number // Amount in dollars (e.g., 100 for $100)
): Promise<Hash> {
  if (!config.acmeUsdAddress) {
    throw new Error("AcmeUSD address not configured");
  }

  const walletClient = createTempoWalletClient();
  const publicClient = createTempoPublicClient();
  const amount = parseUnits(amountUsd.toString(), DECIMALS);

  console.log(`[MINT] Minting ${amountUsd} AcmeUSD to ${toAddress}`);

  const hash = await walletClient.writeContract({
    address: config.acmeUsdAddress,
    abi: TIP20_ABI,
    functionName: "mint",
    args: [toAddress, amount],
  });

  // Wait for transaction to be confirmed
  await publicClient.waitForTransactionReceipt({ hash });

  console.log(`[MINT] Minted successfully. TX: ${hash}`);
  return hash;
}

// Burn AcmeUSD from treasury
export async function burnAcmeUsd(
  amountUsd: number // Amount in dollars
): Promise<Hash> {
  if (!config.acmeUsdAddress) {
    throw new Error("AcmeUSD address not configured");
  }

  const walletClient = createTempoWalletClient();
  const publicClient = createTempoPublicClient();
  const amount = parseUnits(amountUsd.toString(), DECIMALS);

  console.log(`[BURN] Burning ${amountUsd} AcmeUSD from treasury`);

  const hash = await walletClient.writeContract({
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
