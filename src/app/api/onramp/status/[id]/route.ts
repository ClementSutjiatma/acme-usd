import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient, getOnrampByPaymentIntent } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // In Next.js 14+, params is a Promise
    const { id: paymentIntentId } = await params;

    if (!paymentIntentId) {
      return NextResponse.json(
        { error: "Missing payment intent ID" },
        { status: 400 }
      );
    }

    const supabase = createSupabaseClient();
    const onramp = await getOnrampByPaymentIntent(supabase, paymentIntentId);

    console.log(`[STATUS] Fetching status for ${paymentIntentId}, found:`, onramp ? `status=${onramp.status}` : 'NOT FOUND');

    if (!onramp) {
      // Return pending status if record not found yet (race condition)
      console.log(`[STATUS] Record not found, returning pending`);
      return NextResponse.json({
        id: null,
        paymentIntentId,
        userAddress: null,
        amountUsd: 0,
        status: "pending",
        mintTxHash: null,
        errorMessage: null,
        createdAt: null,
      });
    }

    const response = {
      id: onramp.id,
      paymentIntentId: onramp.payment_intent_id,
      userAddress: onramp.user_address,
      amountUsd: onramp.amount_usd / 100, // Convert cents to dollars
      status: onramp.status,
      mintTxHash: onramp.mint_tx_hash,
      errorMessage: onramp.error_message,
      createdAt: onramp.created_at,
    };
    
    console.log(`[STATUS] Returning:`, response.status, response.mintTxHash);
    return NextResponse.json(response);
  } catch (error) {
    console.error("[ONRAMP STATUS] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch onramp status" },
      { status: 500 }
    );
  }
}

