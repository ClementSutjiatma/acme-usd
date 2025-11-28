/**
 * Utility script to check balances
 * 
 * Usage: pnpm check:balance <address>
 */

import { createPublicClient, http, formatUnits, type Address } from "viem";
import { TIP20_ABI } from "../src/lib/contracts";

// Configuration - use Authorization header instead of URL credentials
const TEMPO_RPC_BASE_URL = "https://rpc.testnet.tempo.xyz";
const TEMPO_AUTH = Buffer.from("dreamy-northcutt:recursing-payne").toString("base64");

const TOKENS = {
  LinkingUSD: "0x20c0000000000000000000000000000000000000",
  AlphaUSD: "0x20c0000000000000000000000000000000000001",
  BetaUSD: "0x20c0000000000000000000000000000000000002",
  ThetaUSD: "0x20c0000000000000000000000000000000000003",
  AcmeUSD: process.env.ACME_USD_ADDRESS,
} as const;

const publicClient = createPublicClient({
  transport: http(TEMPO_RPC_BASE_URL, {
    fetchOptions: {
      headers: {
        Authorization: `Basic ${TEMPO_AUTH}`,
      },
    },
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
