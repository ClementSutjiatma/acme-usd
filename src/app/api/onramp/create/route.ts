import { NextRequest, NextResponse } from "next/server";
import { createStripeClient, createPaymentIntent, getOrCreateCustomer } from "@/lib/stripe";
import { createSupabaseClient, createOnrampRecord, getOrCreateUser, updateUserStripeCustomer } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userAddress, amountUsd } = body;

    // Validate inputs
    if (!userAddress || typeof userAddress !== "string") {
      return NextResponse.json(
        { error: "Invalid user address" },
        { status: 400 }
      );
    }

    if (!amountUsd || typeof amountUsd !== "number" || amountUsd <= 0) {
      return NextResponse.json(
        { error: "Invalid amount" },
        { status: 400 }
      );
    }

    // Convert dollars to cents for Stripe
    const amountCents = Math.round(amountUsd * 100);

    const stripe = createStripeClient();
    const supabase = createSupabaseClient();

    // Get or create user record
    const user = await getOrCreateUser(supabase, userAddress);

    // Get or create Stripe Customer
    const customer = await getOrCreateCustomer(stripe, userAddress, user.stripe_customer_id);

    // Update user with Stripe Customer ID if it's new
    if (!user.stripe_customer_id) {
      await updateUserStripeCustomer(supabase, userAddress, customer.id);
      console.log(`[ONRAMP] Linked Stripe customer ${customer.id} to wallet ${userAddress}`);
    }

    // Create Stripe PaymentIntent with customer attached
    // This allows the payment method to be saved for future payouts
    const paymentIntent = await createPaymentIntent(stripe, amountCents, userAddress, customer.id);

    console.log(`[ONRAMP] Created PaymentIntent ${paymentIntent.id} for ${userAddress}, amount: $${amountUsd}`);

    // Store in database
    await createOnrampRecord(supabase, {
      payment_intent_id: paymentIntent.id,
      user_address: userAddress,
      amount_usd: amountCents,
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("[ONRAMP] Create error:", error);
    return NextResponse.json(
      { error: "Failed to create payment intent" },
      { status: 500 }
    );
  }
}
