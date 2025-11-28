import { NextResponse } from "next/server";
import { createTempoPublicClient, hasIssuerRole, getBackendAddress } from "@/lib/tempo";
import { config } from "@/lib/config";

export async function GET() {
  try {
    const checks: Record<string, boolean | string> = {
      tempo_rpc: false,
      backend_wallet: false,
      issuer_role: false,
      stripe: false,
      supabase: false,
    };

    // Check Tempo RPC connection
    try {
      const client = createTempoPublicClient();
      await client.getBlockNumber();
      checks.tempo_rpc = true;
    } catch {
      checks.tempo_rpc = false;
    }

    // Check backend wallet configuration
    try {
      const address = getBackendAddress();
      checks.backend_wallet = address;
    } catch {
      checks.backend_wallet = false;
    }

    // Check ISSUER_ROLE
    try {
      checks.issuer_role = await hasIssuerRole();
    } catch {
      checks.issuer_role = false;
    }

    // Check Stripe configuration
    checks.stripe = !!config.stripeSecretKey;

    // Check Supabase configuration
    checks.supabase = !!(config.supabaseUrl && config.supabaseSecretKey);

    const healthy = Object.values(checks).every((v) => v !== false);

    return NextResponse.json({
      status: healthy ? "healthy" : "degraded",
      checks,
      acmeUsdAddress: config.acmeUsdAddress || "not deployed",
    });
  } catch (error) {
    console.error("[HEALTH] Error:", error);
    return NextResponse.json(
      { status: "unhealthy", error: "Health check failed" },
      { status: 500 }
    );
  }
}

