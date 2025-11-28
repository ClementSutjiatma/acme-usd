import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local BEFORE accessing process.env
const envPath = path.resolve(process.cwd(), ".env.local");
console.log("Loading env from:", envPath);
const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error("Dotenv error:", result.error);
}
console.log("BACKEND_PRIVATE_KEY exists in process.env:", !!process.env.BACKEND_PRIVATE_KEY);

import { createClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempo } from "tempo.ts/chains";
import { keccak256 } from "viem/utils";

// Parse RPC URL from environment
function parseRpcUrl(url: string): { baseUrl: string; auth?: string } {
  try {
    const parsed = new URL(url);
    if (parsed.username && parsed.password) {
      const auth = Buffer.from(`${parsed.username}:${parsed.password}`).toString("base64");
      const baseUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
      return { baseUrl, auth };
    }
    return { baseUrl: url };
  } catch {
    return { baseUrl: url };
  }
}

const rawRpcUrl = process.env.TEMPO_RPC_URL || "https://rpc.testnet.tempo.xyz";
const { baseUrl: tempoRpcBaseUrl, auth: tempoRpcAuth } = parseRpcUrl(rawRpcUrl);

// Inline config to avoid module caching issues
const backendPrivateKey = process.env.BACKEND_PRIVATE_KEY as `0x${string}` | undefined;
const alphaUsdAddress = (process.env.ALPHA_USD_ADDRESS || "0x20c0000000000000000000000000000000000001") as `0x${string}`;

async function main() {
  if (!backendPrivateKey) {
    throw new Error("BACKEND_PRIVATE_KEY not configured");
  }

  console.log("=== Testing Backend Signing ===\n");

  // 1. Load the account
  const account = privateKeyToAccount(backendPrivateKey);
  console.log("Backend Private Key (first 10 chars):", backendPrivateKey.slice(0, 12) + "...");
  console.log("Derived Account Address:", account.address);

  // 2. Verify the account can sign
  const testMessage = "0x68656c6c6f20776f726c64"; // "hello world" in hex
  const testHash = keccak256(testMessage as `0x${string}`);
  console.log("\nTest hash to sign:", testHash);

  try {
    const signature = await account.sign({ hash: testHash });
    console.log("Successfully signed! Signature:", signature.slice(0, 40) + "...");
    console.log("Signature length:", signature.length);
  } catch (error) {
    console.error("Failed to sign:", error);
  }

  // 3. Check the chain configuration
  const chain = tempo({ feeToken: alphaUsdAddress });
  console.log("\nChain ID:", chain.id);
  console.log("Fee Token:", alphaUsdAddress);

  // 4. Create a client and verify it works
  const client = createClient({
    chain,
    transport: http(tempoRpcBaseUrl, {
      fetchOptions: tempoRpcAuth ? {
        headers: {
          Authorization: `Basic ${tempoRpcAuth}`,
        },
      } : undefined,
    }),
  });

  console.log("\nClient created successfully");
  console.log("RPC URL:", tempoRpcBaseUrl);

  // 5. Check the fee payer's balance
  try {
    const balance = await client.readContract({
      address: alphaUsdAddress,
      abi: [
        {
          name: "balanceOf",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
      functionName: "balanceOf",
      args: [account.address],
    });
    console.log(`Fee payer AlphaUSD balance: ${Number(balance) / 1e6} AlphaUSD`);
  } catch (error) {
    console.error("Failed to check balance:", error);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);

