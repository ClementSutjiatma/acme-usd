import { NextRequest, NextResponse } from "next/server";
import { createStripeClient, getBankAccountDetails } from "@/lib/stripe";
import { createSupabaseClient, getUserByAddress } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get("address");

    if (!walletAddress) {
      return NextResponse.json(
        { error: "Missing wallet address" },
        { status: 400 }
      );
    }

    const supabase = createSupabaseClient();
    const stripe = createStripeClient();

    // Get user record
    const user = await getUserByAddress(supabase, walletAddress);

    if (!user || !user.stripe_bank_account_id) {
      return NextResponse.json({
        hasBankAccount: false,
        bankAccount: null,
      });
    }

    // Get bank account details
    const bankDetails = await getBankAccountDetails(stripe, user.stripe_bank_account_id);

    return NextResponse.json({
      hasBankAccount: true,
      bankAccount: bankDetails,
    });
  } catch (error) {
    console.error("[BANK STATUS] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bank account status" },
      { status: 500 }
    );
  }
}

