import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { isAddress } from "viem";

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

    // Transform and combine transactions
    const buyTransactions = (onramps || []).map((tx) => ({
      id: tx.id,
      type: "buy" as const,
      amount: tx.amount_usd / 100, // Convert cents to dollars
      status: mapOnrampStatus(tx.status),
      txHash: tx.mint_tx_hash,
      timestamp: tx.created_at,
    }));

    const withdrawTransactions = (offramps || []).map((tx) => ({
      id: tx.id,
      type: "withdraw" as const,
      amount: tx.amount_usd / 100, // Convert cents to dollars
      status: mapOfframpStatus(tx.status),
      txHash: tx.burn_tx_hash || tx.transfer_tx_hash,
      timestamp: tx.created_at,
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

