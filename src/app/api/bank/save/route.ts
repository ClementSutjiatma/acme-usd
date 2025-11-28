import { NextRequest, NextResponse } from "next/server";
import {
  createStripeClient,
  attachBankAccountToCustomer,
  getBankAccountDetails,
} from "@/lib/stripe";
import {
  createSupabaseClient,
  getUserByAddress,
  updateUserBankAccount,
} from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { walletAddress, accountId } = await request.json();

    if (!walletAddress || !accountId) {
      return NextResponse.json(
        { error: "Missing wallet address or account ID" },
        { status: 400 }
      );
    }

    console.log(`[BANK] Saving bank account ${accountId} for ${walletAddress}`);

    const supabase = createSupabaseClient();
    const stripe = createStripeClient();

    // Get user record
    const user = await getUserByAddress(supabase, walletAddress);

    if (!user || !user.stripe_customer_id) {
      return NextResponse.json(
        { error: "User or Stripe customer not found" },
        { status: 404 }
      );
    }

    // Attach the bank account to the customer as a payment method
    const paymentMethod = await attachBankAccountToCustomer(
      stripe,
      user.stripe_customer_id,
      accountId
    );

    // Get bank account details for display
    const bankDetails = await getBankAccountDetails(stripe, accountId);

    // Save the bank account ID to the user record
    await updateUserBankAccount(supabase, walletAddress, accountId);

    console.log(`[BANK] Saved bank account ${accountId} (${bankDetails?.bankName} ****${bankDetails?.last4})`);

    return NextResponse.json({
      success: true,
      paymentMethodId: paymentMethod.id,
      bankDetails,
    });
  } catch (error) {
    console.error("[BANK] Error saving bank account:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save bank account" },
      { status: 500 }
    );
  }
}

