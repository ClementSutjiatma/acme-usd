import Stripe from "stripe";
import crypto from "crypto";

/**
 * Generate a Stripe webhook signature for testing
 *
 * This mimics Stripe's webhook signing process for test verification
 */
export function generateStripeWebhookSignature(
  payload: string,
  secret: string,
  timestamp?: number
): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${ts}.${payload}`;

  const signature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  return `t=${ts},v1=${signature}`;
}

/**
 * Create a mock PaymentIntent.succeeded event
 */
export function createPaymentIntentSucceededEvent(
  paymentIntentId: string,
  amountCents: number,
  userAddress: string,
  customerId?: string
): Stripe.Event {
  return {
    id: `evt_test_${Date.now()}`,
    object: "event",
    api_version: "2025-02-24.acacia",
    created: Math.floor(Date.now() / 1000),
    type: "payment_intent.succeeded",
    livemode: false,
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    data: {
      object: {
        id: paymentIntentId,
        object: "payment_intent",
        amount: amountCents,
        currency: "usd",
        customer: customerId ?? null,
        status: "succeeded",
        metadata: {
          userAddress,
          type: "onramp",
        },
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        payment_method: "pm_test_123",
        payment_method_types: ["card"],
        receipt_email: null,
        setup_future_usage: null,
        shipping: null,
        source: null,
        statement_descriptor: null,
        statement_descriptor_suffix: null,
        transfer_data: null,
        transfer_group: null,
      } as unknown as Stripe.PaymentIntent,
    },
  } as Stripe.Event;
}

/**
 * Create a mock PaymentIntent.payment_failed event
 */
export function createPaymentIntentFailedEvent(
  paymentIntentId: string,
  amountCents: number,
  userAddress: string,
  errorMessage: string = "Your card was declined."
): Stripe.Event {
  return {
    id: `evt_test_${Date.now()}`,
    object: "event",
    api_version: "2025-02-24.acacia",
    created: Math.floor(Date.now() / 1000),
    type: "payment_intent.payment_failed",
    livemode: false,
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    data: {
      object: {
        id: paymentIntentId,
        object: "payment_intent",
        amount: amountCents,
        currency: "usd",
        customer: null,
        status: "requires_payment_method",
        metadata: {
          userAddress,
          type: "onramp",
        },
        last_payment_error: {
          code: "card_declined",
          message: errorMessage,
          type: "card_error",
        },
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        payment_method: null,
        payment_method_types: ["card"],
        receipt_email: null,
        setup_future_usage: null,
        shipping: null,
        source: null,
        statement_descriptor: null,
        statement_descriptor_suffix: null,
        transfer_data: null,
        transfer_group: null,
      } as unknown as Stripe.PaymentIntent,
    },
  } as Stripe.Event;
}

/**
 * Mock verifyWebhookSignature that accepts any properly formatted signature
 * for testing purposes
 */
export function createMockWebhookVerifier(webhookSecret: string) {
  return (payload: string, signature: string): Stripe.Event => {
    // Extract timestamp from signature
    const elements = signature.split(",");
    const timestamp = elements.find((e) => e.startsWith("t="))?.slice(2);
    const sig = elements.find((e) => e.startsWith("v1="))?.slice(3);

    if (!timestamp || !sig) {
      throw new Error("Invalid signature format");
    }

    // Verify the signature
    const expectedSig = crypto
      .createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    if (sig !== expectedSig) {
      throw new Error("Invalid signature");
    }

    return JSON.parse(payload) as Stripe.Event;
  };
}

/**
 * Test Stripe configuration
 */
export const TEST_STRIPE_CONFIG = {
  // Use a test webhook secret
  webhookSecret: "whsec_test_secret",
  // Test customer ID format
  customerId: (suffix: string = "") => `cus_test_${suffix || Date.now()}`,
  // Test payment intent ID format
  paymentIntentId: (suffix: string = "") => `pi_test_${suffix || Date.now()}`,
  // Test payment method ID format
  paymentMethodId: (suffix: string = "") => `pm_test_${suffix || Date.now()}`,
};

