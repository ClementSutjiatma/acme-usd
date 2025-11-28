import { NextRequest, NextResponse } from "next/server";
import { getAcmeUsdBalance } from "@/lib/tempo";
import { isAddress } from "viem";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    // In Next.js 14+, params is a Promise
    const { address } = await params;

    if (!address || !isAddress(address)) {
      return NextResponse.json(
        { error: "Invalid address" },
        { status: 400 }
      );
    }

    const balance = await getAcmeUsdBalance(address as `0x${string}`);

    return NextResponse.json({
      address,
      balance,
      symbol: "AUSD",
    });
  } catch (error) {
    console.error("[BALANCE] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch balance" },
      { status: 500 }
    );
  }
}

