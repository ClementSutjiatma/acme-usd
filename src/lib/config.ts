// Environment configuration with type safety

// Parse RPC URL - handle both formats (with and without credentials)
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

export const config = {
  // Tempo Testnet - use base URL without credentials
  tempoRpcUrl: rawRpcUrl,
  tempoRpcBaseUrl,
  tempoRpcAuth,
  
  // Contract addresses
  acmeUsdAddress: process.env.ACME_USD_ADDRESS as `0x${string}` | undefined,
  treasuryAddress: process.env.TREASURY_ADDRESS as `0x${string}` | undefined,
  
  // Token addresses (testnet faucet tokens)
  linkingUsdAddress: (process.env.LINKING_USD_ADDRESS || "0x20c0000000000000000000000000000000000000") as `0x${string}`,
  alphaUsdAddress: (process.env.ALPHA_USD_ADDRESS || "0x20c0000000000000000000000000000000000001") as `0x${string}`,
  
  // Precompile addresses
  tip20FactoryAddress: "0x20Fc000000000000000000000000000000000000" as `0x${string}`,
  
  // Stripe
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  stripePublicKey: process.env.NEXT_PUBLIC_STRIPE_KEY || "",
  
  // Supabase (secret API key - starts with sb_secret_...)
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || "",
  
  // Backend wallet
  backendPrivateKey: process.env.BACKEND_PRIVATE_KEY as `0x${string}` | undefined,
  
  // Explorer
  explorerUrl: "https://explore.tempo.xyz",
} as const;

// Parse public RPC URL for client-side
const publicRpcUrl = process.env.NEXT_PUBLIC_TEMPO_RPC_URL || "https://rpc.testnet.tempo.xyz";
const { baseUrl: publicTempoRpcBaseUrl, auth: publicTempoRpcAuth } = parseRpcUrl(publicRpcUrl);

// Public config for client-side
export const publicConfig = {
  tempoRpcBaseUrl: publicTempoRpcBaseUrl,
  tempoRpcAuth: publicTempoRpcAuth,
  acmeUsdAddress: process.env.NEXT_PUBLIC_ACME_USD_ADDRESS as `0x${string}` | undefined,
  alphaUsdAddress: "0x20c0000000000000000000000000000000000001" as `0x${string}`,
  stripePublicKey: process.env.NEXT_PUBLIC_STRIPE_KEY || "",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_KEY || "",
  explorerUrl: "https://explore.tempo.xyz",
} as const;
