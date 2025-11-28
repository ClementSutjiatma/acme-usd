import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local BEFORE accessing process.env
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { createClient, http } from "viem";
import { tempo } from "tempo.ts/chains";

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
const ALPHA_USD = (process.env.ALPHA_USD_ADDRESS || "0x20c0000000000000000000000000000000000001") as `0x${string}`;

const client = createClient({
  chain: tempo({ feeToken: ALPHA_USD }),
  transport: http(TEMPO_RPC_BASE_URL, {
    fetchOptions: TEMPO_AUTH ? {
      headers: {
        Authorization: `Basic ${TEMPO_AUTH}`,
      },
    } : undefined,
  }),
});

async function fund() {
  const address = "0x997AD2224989cCDBBCA40ddEe07D05cca86fF193";
  console.log(`Funding ${address}...`);
  
  try {
    const hash = await client.request({
      method: "tempo_fundAddress",
      params: [address, "0x20c0000000000000000000000000000000000001"], // AlphaUSD
    });
    console.log("Funding tx:", hash);
  } catch (e) {
    console.error("Funding failed:", e);
  }
}

fund();
