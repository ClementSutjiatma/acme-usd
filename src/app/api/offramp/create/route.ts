import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient, createOfframpRecord } from "@/lib/supabase";
import { generateMemo } from "@/lib/blockchain";
import { config } from "@/lib/config";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userAddress, amountUsd } = body;

    // Validate system config first
    if (!config.treasuryAddress) {
      console.error("[OFFRAMP] Treasury address not configured");
      return NextResponse.json(
        { error: "System configuration error: Treasury address not set" },
        { status: 500 }
      );
    }

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

    // Generate unique request ID and memo
    const requestId = randomUUID();
    const memo = generateMemo(requestId);

    // Convert dollars to cents for storage
    const amountCents = Math.round(amountUsd * 100);

    // Store in database
    const supabase = createSupabaseClient();
    const record = await createOfframpRecord(supabase, {
      memo,
      user_address: userAddress,
      amount_usd: amountCents,
    });

    console.log(`[OFFRAMP] Created request ${record.id} for ${userAddress}, amount: $${amountUsd}, memo: ${memo}`);

    return NextResponse.json({
      requestId: record.id,
      memo,
      treasuryAddress: config.treasuryAddress,
      amountUsd,
      instructions: `Send ${amountUsd} AcmeUSD to ${config.treasuryAddress} with memo ${memo}`,
    });
  } catch (error) {
    console.error("[OFFRAMP] Create error:", error);
    return NextResponse.json(
      { error: "Failed to create offramp request" },
      { status: 500 }
    );
  }
}

