/**
 * Setup script for AcmeUSD deployment
 * 
 * This script performs the following operations:
 * 1. Generates a new backend wallet (if needed)
 * 2. Funds the wallet via testnet faucet (if needed)
 * 3. Deploys AcmeUSD token via TIP20Factory (if needed)
 * 4. Grants ISSUER_ROLE to the backend wallet (if needed)
 * 
 * Usage: pnpm deploy:token
 */

import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local BEFORE accessing process.env
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  formatUnits,
  type Address,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { tempo } from "tempo.ts/chains";
import { TIP20_FACTORY_ABI, TIP20_ABI, ISSUER_ROLE } from "../src/lib/contracts";

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

const TIP20_FACTORY = "0x20Fc000000000000000000000000000000000000" as Address;
const LINKING_USD = (process.env.LINKING_USD_ADDRESS || "0x20c0000000000000000000000000000000000000") as Address;
const ALPHA_USD = (process.env.ALPHA_USD_ADDRESS || "0x20c0000000000000000000000000000000000001") as Address;

// Create HTTP transport with auth header
const httpTransport = http(TEMPO_RPC_BASE_URL, {
  fetchOptions: TEMPO_AUTH ? {
    headers: {
      Authorization: `Basic ${TEMPO_AUTH}`,
    },
  } : undefined,
});

// Create chain config with fee token (AlphaUSD is used for gas fees)
const tempoChain = tempo({ feeToken: ALPHA_USD });

// Create clients with proper chain configuration
const publicClient = createPublicClient({
  chain: tempoChain,
  transport: httpTransport,
});

async function main() {
  console.log("=".repeat(60));
  console.log("AcmeUSD Setup Script");
  console.log("=".repeat(60));
  
  // Show what's already configured
  console.log("\n📋 Environment Check:");
  console.log(`   BACKEND_PRIVATE_KEY: ${process.env.BACKEND_PRIVATE_KEY ? "✅ Set" : "❌ Not set"}`);
  console.log(`   TREASURY_ADDRESS: ${process.env.TREASURY_ADDRESS || "Not set"}`);
  console.log(`   ACME_USD_ADDRESS: ${process.env.ACME_USD_ADDRESS || "Not set"}`);
  console.log(`   NEXT_PUBLIC_ACME_USD_ADDRESS: ${process.env.NEXT_PUBLIC_ACME_USD_ADDRESS || "Not set"}`);

  // Step 1: Check for existing private key or generate new one
  let privateKey = process.env.BACKEND_PRIVATE_KEY as `0x${string}` | undefined;

  if (!privateKey) {
    console.log("\n[1/4] Generating new backend wallet...");
    privateKey = generatePrivateKey();
    console.log("   Private Key:", privateKey);
    console.log("   IMPORTANT: Save this key in your .env.local as BACKEND_PRIVATE_KEY");
  } else {
    console.log("\n[1/4] Using existing backend wallet from environment");
  }

  const account = privateKeyToAccount(privateKey);
  console.log("   Address:", account.address);
  console.log("   IMPORTANT: Save this address in your .env.local as TREASURY_ADDRESS");

  const walletClient = createWalletClient({
    account,
    chain: tempoChain,
    transport: httpTransport,
  });

  // Step 2: Fund the wallet via faucet (only if needed)
  console.log("\n[2/4] Checking wallet balance...");
  
  // Check if wallet already has AlphaUSD (used for gas)
  let needsFunding = false;
  try {
    const balance = await publicClient.readContract({
      address: ALPHA_USD,
      abi: TIP20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });
    const balanceFormatted = Number(formatUnits(balance as bigint, 6));
    console.log(`   AlphaUSD balance: ${balanceFormatted.toLocaleString()}`);
    
    if (balanceFormatted < 1000) {
      needsFunding = true;
    } else {
      console.log("   ✅ Wallet already has sufficient funds, skipping faucet");
    }
  } catch (error) {
    console.log("   Could not check balance, will try faucet");
    needsFunding = true;
  }

  if (needsFunding) {
    console.log("   Requesting funds from testnet faucet...");
    try {
      await publicClient.request({
        method: "tempo_fundAddress" as any,
        params: [account.address],
      });
      console.log("   ✅ Wallet funded with testnet tokens!");
      console.log("   - 1M LinkingUSD");
      console.log("   - 1M AlphaUSD");
      console.log("   - 1M BetaUSD");
      console.log("   - 1M ThetaUSD");
    } catch (error) {
      console.log("   ⚠️ Faucet request failed (possibly already funded):", (error as Error).message);
    }
  }

  // Step 3: Deploy AcmeUSD token
  console.log("\n[3/4] Deploying AcmeUSD token via TIP20Factory...");

  // Check if we already have an AcmeUSD address configured
  const existingAddress = process.env.ACME_USD_ADDRESS;
  if (existingAddress) {
    console.log("   Using existing AcmeUSD address:", existingAddress);
    console.log("   Skipping deployment.");
  } else {
    try {
      const deployHash = await walletClient.writeContract({
        address: TIP20_FACTORY,
        abi: TIP20_FACTORY_ABI,
        functionName: "createToken",
        args: [
          "AcmeUSD",           // name
          "AUSD",              // symbol
          "USD",               // currency
          LINKING_USD,         // quoteToken
          account.address,     // admin
        ],
      });

      console.log("   Deploy TX:", deployHash);
      console.log("   Waiting for confirmation...");

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: deployHash,
      });

      // Parse the TokenCreated event to get the deployed token address
      let tokenAddress: Address | undefined;
      
      try {
        const logs = parseEventLogs({
          abi: TIP20_FACTORY_ABI,
          logs: receipt.logs,
          eventName: "TokenCreated",
        });

        if (logs.length > 0) {
          tokenAddress = logs[0].args.token as Address;
        }
      } catch (parseError) {
        console.log("   Note: Could not parse TokenCreated event directly");
      }

      // Fallback: Look for the token address in raw logs
      // TokenCreated event signature: TokenCreated(address indexed token, address indexed admin)
      if (!tokenAddress && receipt.logs.length > 0) {
        // The token address is usually in the first indexed topic after the event signature
        for (const log of receipt.logs) {
          if (log.topics && log.topics.length >= 2) {
            // Extract address from topic (topics are 32 bytes, address is 20 bytes)
            const potentialAddress = ("0x" + log.topics[1]?.slice(-40)) as Address;
            if (potentialAddress && potentialAddress.startsWith("0x") && potentialAddress.length === 42) {
              tokenAddress = potentialAddress;
              break;
            }
          }
        }
      }

      if (tokenAddress) {
        console.log("   ✅ AcmeUSD deployed at:", tokenAddress);
        console.log("   ");
        console.log("   Add these to your .env.local:");
        console.log(`   ACME_USD_ADDRESS=${tokenAddress}`);
        console.log(`   NEXT_PUBLIC_ACME_USD_ADDRESS=${tokenAddress}`);
      } else {
        console.log("   ⚠️ Could not automatically extract token address from logs");
        console.log("   ");
        console.log("   View transaction on explorer to find your token address:");
        console.log(`   https://explore.tempo.xyz/tx/${deployHash}`);
        console.log("   ");
        console.log("   Transaction Hash:", deployHash);
        console.log("   Logs count:", receipt.logs.length);
      }
    } catch (error) {
      console.error("   Deployment failed:", error);
      throw error;
    }
  }

  // Step 4: Grant ISSUER_ROLE
  console.log("\n[4/4] Granting ISSUER_ROLE to backend wallet...");

  const acmeUsdAddress = process.env.ACME_USD_ADDRESS as Address | undefined;
  if (!acmeUsdAddress) {
    console.log("   Skipping - ACME_USD_ADDRESS not set");
    console.log("   After setting ACME_USD_ADDRESS, run this script again to grant ISSUER_ROLE");
  } else {
    try {
      // First, fetch the actual ISSUER_ROLE bytes32 from the contract
      // (don't rely on pre-computed hash - TIP-20 contracts may use different values)
      console.log("   Fetching ISSUER_ROLE from contract...");
      let issuerRole: `0x${string}`;
      
      try {
        issuerRole = await publicClient.readContract({
          address: acmeUsdAddress,
          abi: TIP20_ABI,
          functionName: "ISSUER_ROLE",
        }) as `0x${string}`;
        console.log("   ISSUER_ROLE from contract:", issuerRole);
      } catch (roleError) {
        // Fallback to computed value if getter fails
        console.log("   Could not fetch ISSUER_ROLE from contract, using computed value");
        issuerRole = ISSUER_ROLE as `0x${string}`;
      }
      
      // Check if we already have the role
      console.log("   Checking if backend wallet already has role...");
      let hasRoleResult = false;
      
      try {
        hasRoleResult = await publicClient.readContract({
          address: acmeUsdAddress,
          abi: TIP20_ABI,
          functionName: "hasRole",
          args: [issuerRole, account.address],
        }) as boolean;
      } catch (checkError) {
        // If hasRole check fails, try granting anyway
        // The admin who created the token might automatically have all roles
        console.log("   hasRole check failed, will attempt to grant role anyway");
        console.log("   Note: If you are the admin, you may already have mint/burn permissions");
      }

      if (hasRoleResult) {
        console.log("   ✅ Backend wallet already has ISSUER_ROLE");
      } else {
        try {
          const grantHash = await walletClient.writeContract({
            address: acmeUsdAddress,
            abi: TIP20_ABI,
            functionName: "grantRole",
            args: [issuerRole, account.address],
          });

          console.log("   Grant Role TX:", grantHash);
          await publicClient.waitForTransactionReceipt({ hash: grantHash });
          console.log("   ✅ ISSUER_ROLE granted successfully!");
        } catch (grantError) {
          console.log("   ⚠️ Could not grant ISSUER_ROLE explicitly");
          console.log("   This might be OK - as the token admin, you may already have mint/burn permissions");
          console.log("   Try minting tokens directly to verify");
        }
      }
    } catch (error) {
      console.error("   Failed during ISSUER_ROLE setup:", error);
      console.log("\n   Note: As the token admin, you may already have permission to mint/burn.");
      console.log("   The token was deployed with your address as admin.");
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("Setup Complete!");
  console.log("=".repeat(60));
  console.log("\nNext steps:");
  console.log("1. Copy the values above to your .env.local file");
  console.log("2. Create Supabase project and run the migration");
  console.log("3. Set up Stripe test account and get API keys");
  console.log("4. Run 'pnpm dev' to start the development server");
}

main().catch(console.error);
