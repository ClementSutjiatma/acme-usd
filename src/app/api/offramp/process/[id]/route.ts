import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseClient,
  getOfframpById,
  updateOfframpStatus,
  getUserByAddress,
} from "@/lib/supabase";
import {
  burnAcmeUsd,
  createTempoPublicClient,
} from "@/lib/tempo";
import { createStripeClient, createPayout } from "@/lib/stripe";
import { type Hash } from "viem";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60 seconds for processing

// TransferWithMemo event ABI for listening to transfer events
const TRANSFER_WITH_MEMO_EVENT = {
  type: "event",
  name: "TransferWithMemo",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256" },
    { name: "memo", type: "bytes32", indexed: true },
  ],
} as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: offrampId } = await params;

    // Get txHash from request body (if provided)
    let txHash: Hash | undefined;
    try {
      const body = await request.json();
      txHash = body.txHash as Hash | undefined;
    } catch {
      // No body or invalid JSON - that's okay
    }

    if (!offrampId) {
      return NextResponse.json(
        { error: "Missing offramp ID" },
        { status: 400 }
      );
    }

    console.log(`[PROCESS] Processing offramp ${offrampId} with txHash: ${txHash || "none"}...`);

    const supabase = createSupabaseClient();
    const stripe = createStripeClient();

    // Get the offramp record
    const offramp = await getOfframpById(supabase, offrampId);

    if (!offramp) {
      return NextResponse.json(
        { error: "Offramp not found" },
        { status: 404 }
      );
    }

    // Skip if already processed
    if (offramp.status !== "pending") {
      console.log(`[PROCESS] Offramp ${offrampId} already in status: ${offramp.status}`);
      return NextResponse.json({
        success: true,
        status: offramp.status,
        message: "Already processed",
      });
    }

    // Wait for the transaction to be confirmed
    if (!txHash) {
      console.log(`[PROCESS] No txHash provided - cannot process`);
      return NextResponse.json(
        { error: "Missing transaction hash" },
        { status: 400 }
      );
    }

    console.log(`[PROCESS] Waiting for tx ${txHash} to be confirmed...`);
    const publicClient = createTempoPublicClient();

    // Tempo best practice: Poll for transaction receipt with retries
    // Tempo has ~1 second finality, so we poll every second
    let receipt = null;
    const maxAttempts = 30; // 30 attempts * 2s = 60s max
    const pollInterval = 2000; // 2 seconds

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        receipt = await publicClient.getTransactionReceipt({ hash: txHash });
        if (receipt) {
          console.log(`[PROCESS] Transaction confirmed in block ${receipt.blockNumber} (attempt ${attempt})`);
          break;
        }
      } catch {
        // Transaction not found yet - this is expected
      }

      if (attempt < maxAttempts) {
        console.log(`[PROCESS] Waiting for confirmation (attempt ${attempt}/${maxAttempts})...`);
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    // Fallback: If no receipt, try to find the TransferWithMemo event by memo
    // This aligns with Tempo's recommended watchEvent pattern
    if (!receipt) {
      console.log(`[PROCESS] No receipt found, searching for TransferWithMemo event by memo...`);
      
      const currentBlock = await publicClient.getBlockNumber();
      const fromBlock = currentBlock > BigInt(100) ? currentBlock - BigInt(100) : BigInt(0);
      
      const logs = await publicClient.getLogs({
        address: config.acmeUsdAddress,
        event: TRANSFER_WITH_MEMO_EVENT,
        args: {
          to: config.treasuryAddress,
          memo: offramp.memo as `0x${string}`,
        },
        fromBlock,
        toBlock: "latest",
      });

      if (logs.length > 0) {
        console.log(`[PROCESS] Found TransferWithMemo event in tx ${logs[0].transactionHash}`);
        txHash = logs[0].transactionHash;
        receipt = await publicClient.getTransactionReceipt({ hash: txHash });
      }
    }

    if (!receipt) {
      console.log(`[PROCESS] Transaction not confirmed after ${maxAttempts} attempts`);
      return NextResponse.json(
        { error: "Transaction not confirmed yet. Please try again." },
        { status: 202 }
      );
    }

    if (receipt.status !== "success") {
      console.log(`[PROCESS] Transaction ${txHash} failed on-chain`);
      console.log(`[PROCESS] Receipt status: ${receipt.status}`);
      console.log(`[PROCESS] Receipt logs:`, receipt.logs);
      
      // The transfer reverted - likely insufficient balance or wrong contract
      // This happens when fee is paid but the actual call fails
      return NextResponse.json(
        { 
          error: "Transaction reverted on-chain. The transfer call failed - check balance and contract addresses.",
          txHash,
          status: receipt.status,
        },
        { status: 400 }
      );
    }

    // Process the offramp
    try {
      // Update status to transferred
      console.log(`[PROCESS] Updating status to transferred...`);
      await updateOfframpStatus(supabase, offramp.id, {
        status: "transferred",
        transfer_tx_hash: txHash,
      });

      // Burn the tokens
      console.log(`[PROCESS] Burning ${offramp.amount_usd / 100} AcmeUSD...`);
      const burnTxHash = await burnAcmeUsd(offramp.amount_usd / 100);

      await updateOfframpStatus(supabase, offramp.id, {
        status: "burned",
        burn_tx_hash: burnTxHash,
      });

      // Look up user's Stripe Customer and bank account for payout
      const user = await getUserByAddress(supabase, offramp.user_address);
      const bankAccountId = user?.stripe_bank_account_id || undefined;

      if (bankAccountId) {
        console.log(`[PROCESS] Found bank account ${bankAccountId}`);
      } else {
        console.log(`[PROCESS] No bank account linked, using demo payout`);
      }

      // Create payout to bank account
      console.log(`[PROCESS] Creating payout...`);
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

      console.log(`[PROCESS] Completed offramp ${offramp.id}`);

      return NextResponse.json({
        success: true,
        status: "paid_out",
        transferTxHash: txHash,
        burnTxHash,
        payoutId: payout.id,
      });
    } catch (error) {
      console.error(`[PROCESS] Failed to process offramp ${offramp.id}:`, error);
      
      await updateOfframpStatus(supabase, offramp.id, {
        status: "failed",
        error_message: error instanceof Error ? error.message : "Processing failed",
      });

      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Processing failed" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("[PROCESS] Error:", error);
    return NextResponse.json(
      { error: "Failed to process offramp" },
      { status: 500 }
    );
  }
}

