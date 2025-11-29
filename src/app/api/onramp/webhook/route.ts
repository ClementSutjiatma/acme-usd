import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/stripe";
import {
  createSupabaseClient,
  getOnrampByPaymentIntent,
  updateOnrampStatus,
} from "@/lib/supabase";
import { mintAcmeUsd } from "@/lib/blockchain";
import type Stripe from "stripe";

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing stripe-signature header" },
        { status: 400 }
      );
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = verifyWebhookSignature(body, signature);
    } catch (err) {
      console.error("[WEBHOOK] Signature verification failed:", err);
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 400 }
      );
    }

    const supabase = createSupabaseClient();

    // Handle the event
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const { userAddress } = paymentIntent.metadata;
        const amountCents = paymentIntent.amount;
        const amountUsd = amountCents / 100;

        console.log(`[WEBHOOK] payment_intent.succeeded: ${paymentIntent.id}`);

        // Check idempotency - skip if already processed
        const existing = await getOnrampByPaymentIntent(supabase, paymentIntent.id);
        if (existing?.status === "minted") {
          console.log(`[WEBHOOK] Already minted for ${paymentIntent.id}, skipping`);
          return NextResponse.json({ received: true });
        }

        // Update status to minting
        console.log(`[WEBHOOK] Updating status to 'minting' for ${paymentIntent.id}`);
        const mintingUpdate = await updateOnrampStatus(supabase, paymentIntent.id, {
          status: "minting",
        });
        console.log(`[WEBHOOK] Status updated to 'minting':`, mintingUpdate?.status);

        try {
          // Mint AcmeUSD to user with payment intent ID as memo for on-chain auditability
          // We don't await here to avoid Stripe webhook timeout
          // mintAcmeUsd now includes timeout recovery - if RPC times out but balance increases, it succeeds
          mintAcmeUsd(
            userAddress as `0x${string}`,
            amountUsd,
            paymentIntent.id // Store payment_intent_id on-chain for auditability
          ).then(async (mintTxHash) => {
            // Update status to minted
            // Note: mintTxHash may be a placeholder (0x000...0) if mint was verified via balance check after timeout
            const isVerifiedMint = mintTxHash === `0x${'0'.repeat(64)}`;
            console.log(`[WEBHOOK] Updating status to 'minted' for ${paymentIntent.id}${isVerifiedMint ? ' (verified via balance check)' : ''}`);
            
            const mintedUpdate = await updateOnrampStatus(supabase, paymentIntent.id, {
              status: "minted",
              mint_tx_hash: isVerifiedMint ? undefined : mintTxHash, // Don't store placeholder hash
            });
            console.log(`[WEBHOOK] Status updated to 'minted':`, mintedUpdate?.status);
            console.log(`[WEBHOOK] Minted ${amountUsd} AcmeUSD to ${userAddress}${isVerifiedMint ? ' (tx hash unavailable - verified via balance)' : `, tx: ${mintTxHash}`}`);
          }).catch(async (mintError) => {
            // If we get here, the mint truly failed (balance did not increase after timeout, or other error)
            const errorMessage = mintError instanceof Error ? mintError.message : "Unknown error";
            const isTimeout = errorMessage.toLowerCase().includes('timeout');
            
            console.error(`[WEBHOOK] Mint failed${isTimeout ? ' (timeout, balance verification also failed)' : ''}:`, mintError);
            
            await updateOnrampStatus(supabase, paymentIntent.id, {
              status: "failed",
              error_message: isTimeout 
                ? `Timeout: ${errorMessage} (balance verification failed)` 
                : errorMessage,
            });
          });

        } catch (err) {
          // This catch block might not be reached due to async execution, but kept for safety
          console.error("[WEBHOOK] Mint initiation failed:", err);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log(`[WEBHOOK] payment_intent.payment_failed: ${paymentIntent.id}`);

        await updateOnrampStatus(supabase, paymentIntent.id, {
          status: "failed",
          error_message: paymentIntent.last_payment_error?.message || "Payment failed",
        });
        break;
      }

      default:
        console.log(`[WEBHOOK] Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[WEBHOOK] Error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}

