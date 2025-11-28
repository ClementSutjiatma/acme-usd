/**
 * Utility script to check balances
 * 
 * Usage: pnpm check:balance <address>
 */

import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local BEFORE accessing process.env
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { createPublicClient, http, formatUnits, type Address } from "viem";
import { TIP20_ABI } from "../src/lib/contracts";

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

const TOKENS = {
  LinkingUSD: "0x20c0000000000000000000000000000000000000",
  AlphaUSD: "0x20c0000000000000000000000000000000000001",
  BetaUSD: "0x20c0000000000000000000000000000000000002",
  ThetaUSD: "0x20c0000000000000000000000000000000000003",
  AcmeUSD: process.env.ACME_USD_ADDRESS,
} as const;

const publicClient = createPublicClient({
  transport: http(TEMPO_RPC_BASE_URL, {
    fetchOptions: TEMPO_AUTH ? {
      headers: {
        Authorization: `Basic ${TEMPO_AUTH}`,
      },
    } : undefined,
  }),
});

async function main() {
  const address = (process.argv[2] || process.env.TREASURY_ADDRESS) as Address;

  if (!address) {
    console.error("Usage: pnpm check:balance <address>");
    console.error("Or set TREASURY_ADDRESS in environment");
    process.exit(1);
  }

  console.log("Checking balances for:", address);
  console.log("-".repeat(50));

  for (const [name, tokenAddress] of Object.entries(TOKENS)) {
    if (!tokenAddress) {
      console.log(`${name}: Not configured`);
      continue;
    }

    try {
      const balance = await publicClient.readContract({
        address: tokenAddress as Address,
        abi: TIP20_ABI,
        functionName: "balanceOf",
        args: [address],
      });

      const formatted = formatUnits(balance as bigint, 6);
      console.log(`${name}: ${formatted}`);
    } catch (error) {
      console.log(`${name}: Error reading balance`);
    }
  }
}

main().catch(console.error);
