import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseClient,
  getPendingOfframps,
  getOfframpByMemo,
  updateOfframpStatus,
  getUserByAddress,
} from "@/lib/supabase";
import {
  getTransfersToTreasury,
  burnAcmeUsd,
} from "@/lib/tempo";
import { createStripeClient, createPayout } from "@/lib/stripe";

// Verify cron secret to prevent unauthorized access
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  try {
    // Verify authorization (Vercel Cron sends this header)
    const authHeader = request.headers.get("authorization");
    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[CRON] Checking for pending offramps...");

    const supabase = createSupabaseClient();
    const stripe = createStripeClient();

    // Get all pending offramps
    const pendingOfframps = await getPendingOfframps(supabase);

    if (pendingOfframps.length === 0) {
      console.log("[CRON] No pending offramps");
      return NextResponse.json({ processed: 0 });
    }

    console.log(`[CRON] Found ${pendingOfframps.length} pending offramps`);

    // Get recent transfers to treasury (last 1000 blocks)
    // Note: In production, track the last processed block
    const transfers = await getTransfersToTreasury();

    let processed = 0;

    for (const transfer of transfers) {
      const memoHex = transfer.memo;

      // Find matching offramp request
      const offramp = await getOfframpByMemo(supabase, memoHex);

      if (!offramp) {
        console.log(`[CRON] Unknown memo ${memoHex}, skipping`);
        continue;
      }

      if (offramp.status !== "pending") {
        console.log(`[CRON] Offramp ${offramp.id} already processed (${offramp.status})`);
        continue;
      }

      console.log(`[CRON] Processing offramp ${offramp.id}, memo: ${memoHex}`);

      try {
        // Update status to transferred
        await updateOfframpStatus(supabase, offramp.id, {
          status: "transferred",
          transfer_tx_hash: transfer.transactionHash,
        });

        // Burn the tokens
        const amountUsd = offramp.amount_usd / 100;
        const burnTxHash = await burnAcmeUsd(amountUsd);

        await updateOfframpStatus(supabase, offramp.id, {
          status: "burned",
          burn_tx_hash: burnTxHash,
        });

        // Look up user's Stripe Customer and bank account for payout
        const user = await getUserByAddress(supabase, offramp.user_address);
        const bankAccountId = user?.stripe_bank_account_id || undefined;
        
        if (bankAccountId) {
          console.log(`[CRON] Found bank account ${bankAccountId} for user ${offramp.user_address}`);
        }

        // Create payout to bank account
        const payout = await createPayout(
          stripe, 
          offramp.amount_usd, 
          offramp.id,
          user?.stripe_customer_id || undefined,
          bankAccountId
        );

        await updateOfframpStatus(supabase, offramp.id, {
          status: "paid_out",
          stripe_payout_id: payout.id,
        });

        console.log(`[CRON] Completed offramp ${offramp.id}`);
        processed++;
      } catch (error) {
        console.error(`[CRON] Failed to process offramp ${offramp.id}:`, error);
        await updateOfframpStatus(supabase, offramp.id, {
          status: "failed",
          error_message: error instanceof Error ? error.message : "Processing failed",
        });
      }
    }

    return NextResponse.json({ processed, total: pendingOfframps.length });
  } catch (error) {
    console.error("[CRON] Error:", error);
    return NextResponse.json(
      { error: "Cron job failed" },
      { status: 500 }
    );
  }
}
