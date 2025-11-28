import { NextRequest, NextResponse } from "next/server";
import {
  createStripeClient,
  getOrCreateCustomer,
  createFinancialConnectionsSession,
} from "@/lib/stripe";
import {
  createSupabaseClient,
  getOrCreateUser,
  updateUserStripeCustomer,
} from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { walletAddress } = await request.json();

    if (!walletAddress) {
      return NextResponse.json(
        { error: "Missing wallet address" },
        { status: 400 }
      );
    }

    console.log(`[BANK] Creating Financial Connections session for ${walletAddress}`);

    const supabase = createSupabaseClient();
    const stripe = createStripeClient();

    // Get or create user record
    let user = await getOrCreateUser(supabase, walletAddress);

    // Get or create Stripe Customer
    const customer = await getOrCreateCustomer(
      stripe,
      walletAddress,
      user.stripe_customer_id
    );

    // Update user with customer ID if new
    if (!user.stripe_customer_id) {
      user = await updateUserStripeCustomer(supabase, walletAddress, customer.id);
    }

    // Create Financial Connections session
    const session = await createFinancialConnectionsSession(stripe, customer.id);

    console.log(`[BANK] Created session ${session.id} for customer ${customer.id}`);

    return NextResponse.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("[BANK] Error creating session:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create session" },
      { status: 500 }
    );
  }
}

