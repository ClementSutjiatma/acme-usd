import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { isAddress, keccak256, toBytes } from "viem";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    if (!address || !isAddress(address)) {
      return NextResponse.json(
        { error: "Invalid address" },
        { status: 400 }
      );
    }

    const supabase = createSupabaseClient();

    // Fetch onramps (buys) - use ilike for case-insensitive match
    const { data: onramps, error: onrampError } = await supabase
      .from("onramps")
      .select("*")
      .ilike("user_address", address)
      .order("created_at", { ascending: false })
      .limit(20);

    if (onrampError) {
      console.error("[TRANSACTIONS] Onramp fetch error:", onrampError);
    }

    // Fetch offramps (withdrawals) - use ilike for case-insensitive match
    const { data: offramps, error: offrampError } = await supabase
      .from("offramps")
      .select("*")
      .ilike("user_address", address)
      .order("created_at", { ascending: false })
      .limit(20);

    if (offrampError) {
      console.error("[TRANSACTIONS] Offramp fetch error:", offrampError);
    }

    // Transform and combine transactions with audit fields
    const buyTransactions = (onramps || []).map((tx) => ({
      id: tx.id,
      type: "buy" as const,
      amount: tx.amount_usd / 100, // Convert cents to dollars
      status: mapOnrampStatus(tx.status),
      txHash: tx.mint_tx_hash,
      timestamp: tx.created_at,
      // Audit fields for on-chain verification
      mintTxHash: tx.mint_tx_hash,
      paymentReference: tx.payment_intent_id,
      // Memo hash is keccak256 of payment_intent_id (what's stored on-chain)
      memoHash: tx.payment_intent_id ? keccak256(toBytes(tx.payment_intent_id)) : undefined,
    }));

    const withdrawTransactions = (offramps || []).map((tx) => ({
      id: tx.id,
      type: "withdraw" as const,
      amount: tx.amount_usd / 100, // Convert cents to dollars
      status: mapOfframpStatus(tx.status),
      txHash: tx.burn_tx_hash || tx.transfer_tx_hash,
      timestamp: tx.created_at,
      // Audit fields for on-chain verification
      burnTxHash: tx.burn_tx_hash,
      transferTxHash: tx.transfer_tx_hash,
      paymentReference: tx.stripe_payout_id,
      // For offramp, burn memo is keccak256 of payout_id, transfer memo is stored directly
      memoHash: tx.stripe_payout_id ? keccak256(toBytes(tx.stripe_payout_id)) : tx.memo,
      transferMemo: tx.memo, // The memo from user's transfer to treasury
    }));

    // Combine and sort by timestamp
    const allTransactions = [...buyTransactions, ...withdrawTransactions].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return NextResponse.json({
      transactions: allTransactions,
    });
  } catch (error) {
    console.error("[TRANSACTIONS] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}

function mapOnrampStatus(status: string): "completed" | "pending" | "failed" {
  switch (status) {
    case "minted":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

function mapOfframpStatus(status: string): "completed" | "pending" | "failed" {
  switch (status) {
    case "paid_out":
    case "burned":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

