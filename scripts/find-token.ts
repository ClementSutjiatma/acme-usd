/**
 * Script to find the deployed token address from a transaction hash
 */

import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local BEFORE accessing process.env
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { createPublicClient, http, decodeEventLog, type Address } from "viem";
import { tempo } from "tempo.ts/chains";
import { TIP20_FACTORY_ABI } from "../src/lib/contracts";

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
const { baseUrl: TEMPO_RPC_BASE_URL, auth: TEMPO_AUTH } = parseRpcUrl(rawRpcUrl);
const ALPHA_USD = (process.env.ALPHA_USD_ADDRESS || "0x20c0000000000000000000000000000000000001") as Address;

const httpTransport = http(TEMPO_RPC_BASE_URL, {
  fetchOptions: TEMPO_AUTH ? {
    headers: {
      Authorization: `Basic ${TEMPO_AUTH}`,
    },
  } : undefined,
});

const publicClient = createPublicClient({
  chain: tempo({ feeToken: ALPHA_USD }),
  transport: httpTransport,
});

async function main() {
  // Your deployment transaction hash
  const txHash = "0x39bc26501454bd9358f0e3ddd137da5f3941ba36f16cd36a96e4db887492d482" as `0x${string}`;

  console.log("Fetching transaction receipt...");
  console.log("TX Hash:", txHash);

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });

  console.log("\nTransaction Status:", receipt.status);
  console.log("Block Number:", receipt.blockNumber.toString());
  console.log("Logs Count:", receipt.logs.length);

  // Look for TokenCreated event
  // Event signature: TokenCreated(address indexed token, address indexed admin)
  const TOKEN_CREATED_TOPIC = "0x2a9e7867d66f6a526a956fb29a62e9c4fd7c3e760e9f9e2c26b7a6a1b9e7f8d3";

  console.log("\n--- Analyzing Logs ---");

  for (let i = 0; i < receipt.logs.length; i++) {
    const log = receipt.logs[i];
    console.log(`\nLog ${i}:`);
    console.log("  Address:", log.address);
    console.log("  Topics:", log.topics);

    // Try to decode as TokenCreated event
    if (log.address.toLowerCase() === "0x20fc000000000000000000000000000000000000") {
      console.log("  ^ This is from TIP20Factory!");

      // The token address should be in topic[1] (first indexed param)
      if (log.topics && log.topics.length >= 2) {
        // Extract address from 32-byte topic (last 40 hex chars = 20 bytes)
        const tokenAddress = "0x" + log.topics[1]?.slice(-40);
        console.log("\n===========================================");
        console.log("🎉 FOUND TOKEN ADDRESS:", tokenAddress);
        console.log("===========================================");
        console.log("\nAdd this to your .env.local:");
        console.log(`ACME_USD_ADDRESS=${tokenAddress}`);
        console.log(`NEXT_PUBLIC_ACME_USD_ADDRESS=${tokenAddress}`);
        return;
      }
    }
  }

  // If we didn't find it in topics, try raw data parsing
  console.log("\n--- Trying alternative parsing ---");
  for (const log of receipt.logs) {
    if (log.data && log.data.length > 2) {
      console.log("Log data:", log.data);
    }
  }

  console.log("\nCould not automatically find token address.");
  console.log("Raw logs for manual inspection:");
  for (const log of receipt.logs) {
    console.log(JSON.stringify({
      address: log.address,
      topics: log.topics,
      data: log.data,
    }, null, 2));
  }
}

main().catch(console.error);

