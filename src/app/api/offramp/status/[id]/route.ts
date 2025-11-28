import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient, getOfframpById } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // In Next.js 14+, params is a Promise
    const { id: requestId } = await params;

    if (!requestId) {
      return NextResponse.json(
        { error: "Missing request ID" },
        { status: 400 }
      );
    }

    const supabase = createSupabaseClient();
    const offramp = await getOfframpById(supabase, requestId);

    if (!offramp) {
      return NextResponse.json(
        { error: "Offramp request not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      requestId: offramp.id,
      memo: offramp.memo,
      userAddress: offramp.user_address,
      amountUsd: offramp.amount_usd / 100, // Convert cents to dollars
      status: offramp.status,
      transferTxHash: offramp.transfer_tx_hash,
      burnTxHash: offramp.burn_tx_hash,
      payoutId: offramp.stripe_payout_id,
      errorMessage: offramp.error_message,
      createdAt: offramp.created_at,
    });
  } catch (error) {
    console.error("[OFFRAMP STATUS] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch offramp status" },
      { status: 500 }
    );
  }
}

