import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  generateTestWallet,
} from "../../helpers/setup";
import {
  generateStripeWebhookSignature,
  createPaymentIntentSucceededEvent,
  createPaymentIntentFailedEvent,
  TEST_STRIPE_CONFIG,
} from "../../helpers/stripe-mock";

// Track mock state for supabase
let mockOnramps: Map<string, {
  id: string;
  payment_intent_id: string;
  user_address: string;
  amount_usd: number;
  status: string;
  mint_tx_hash: string | null;
  error_message: string | null;
}> = new Map();

// Mock the stripe verification and tempo minting
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual("@/lib/stripe");
  return {
    ...actual,
    verifyWebhookSignature: vi.fn((payload: string) => {
      // Parse and return the event for testing
      return JSON.parse(payload);
    }),
  };
});

vi.mock("@/lib/tempo", async () => {
  const actual = await vi.importActual("@/lib/tempo");
  return {
    ...actual,
    mintAcmeUsd: vi.fn(async () => {
      // Return a mock transaction hash
      return `0x${"a".repeat(64)}`;
    }),
  };
});

// Mock supabase to use in-memory storage
vi.mock("@/lib/supabase", () => ({
  createSupabaseClient: vi.fn(() => ({})),
  getOnrampByPaymentIntent: vi.fn(async (_supabase: unknown, paymentIntentId: string) => {
    return mockOnramps.get(paymentIntentId) || null;
  }),
  updateOnrampStatus: vi.fn(async (_supabase: unknown, paymentIntentId: string, update: {
    status: string;
    mint_tx_hash?: string;
    error_message?: string;
  }) => {
    const existing = mockOnramps.get(paymentIntentId);
    if (existing) {
      const updated = { ...existing, ...update };
      mockOnramps.set(paymentIntentId, updated);
      return updated;
    }
    throw new Error("Record not found");
  }),
}));

describe("POST /api/onramp/webhook", () => {
  beforeEach(async () => {
    mockOnramps.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    mockOnramps.clear();
  });

  // Helper to create a mock onramp record
  function createMockOnramp(overrides: {
    payment_intent_id?: string;
    user_address?: string;
    amount_usd?: number;
    status?: string;
    mint_tx_hash?: string | null;
    error_message?: string | null;
  } = {}) {
    const paymentIntentId = overrides.payment_intent_id ?? `pi_test_${Date.now()}`;
    const record = {
      id: `id_${Date.now()}`,
      payment_intent_id: paymentIntentId,
      user_address: overrides.user_address ?? generateTestWallet().address.toLowerCase(),
      amount_usd: overrides.amount_usd ?? 10000,
      status: overrides.status ?? "pending",
      mint_tx_hash: overrides.mint_tx_hash ?? null,
      error_message: overrides.error_message ?? null,
    };
    mockOnramps.set(paymentIntentId, record);
    return record;
  }

  it("should handle payment_intent.succeeded and update status to minting", async () => {
    const { POST } = await import("@/app/api/onramp/webhook/route");
    const wallet = generateTestWallet();

    // Create mock onramp record
    const onramp = createMockOnramp({
      user_address: wallet.address.toLowerCase(),
      status: "pending",
    });

    // Create Stripe event
    const event = createPaymentIntentSucceededEvent(
      onramp.payment_intent_id,
      onramp.amount_usd,
      wallet.address
    );

    const payload = JSON.stringify(event);
    const signature = generateStripeWebhookSignature(
      payload,
      TEST_STRIPE_CONFIG.webhookSecret
    );

    const request = new NextRequest(
      "http://localhost:3000/api/onramp/webhook",
      {
        method: "POST",
        body: payload,
        headers: {
          "stripe-signature": signature,
        },
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.received).toBe(true);

    // Allow async mint to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify status was updated in our mock
    const updatedOnramp = mockOnramps.get(onramp.payment_intent_id);

    // Status should be minted (after async completion) or minting
    expect(["minting", "minted"]).toContain(updatedOnramp?.status);
  });

  it("should skip re-minting for duplicate webhook (idempotency)", async () => {
    const { POST } = await import("@/app/api/onramp/webhook/route");
    const { mintAcmeUsd } = await import("@/lib/tempo");
    const wallet = generateTestWallet();

    // Create mock onramp record that's already minted
    const onramp = createMockOnramp({
      user_address: wallet.address.toLowerCase(),
      status: "minted",
      mint_tx_hash: `0x${"b".repeat(64)}`,
    });

    const event = createPaymentIntentSucceededEvent(
      onramp.payment_intent_id,
      onramp.amount_usd,
      wallet.address
    );

    const payload = JSON.stringify(event);
    const signature = generateStripeWebhookSignature(
      payload,
      TEST_STRIPE_CONFIG.webhookSecret
    );

    const request = new NextRequest(
      "http://localhost:3000/api/onramp/webhook",
      {
        method: "POST",
        body: payload,
        headers: {
          "stripe-signature": signature,
        },
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(200);

    // Mint should NOT be called again
    expect(mintAcmeUsd).not.toHaveBeenCalled();

    // Status should still be minted with original tx hash
    const unchangedOnramp = mockOnramps.get(onramp.payment_intent_id);

    expect(unchangedOnramp?.status).toBe("minted");
    expect(unchangedOnramp?.mint_tx_hash).toBe(`0x${"b".repeat(64)}`);
  });

  it("should set status to failed on payment_intent.payment_failed", async () => {
    const { POST } = await import("@/app/api/onramp/webhook/route");
    const wallet = generateTestWallet();

    // Create mock onramp record
    const onramp = createMockOnramp({
      user_address: wallet.address.toLowerCase(),
      status: "pending",
    });

    const event = createPaymentIntentFailedEvent(
      onramp.payment_intent_id,
      onramp.amount_usd,
      wallet.address,
      "Your card was declined."
    );

    const payload = JSON.stringify(event);
    const signature = generateStripeWebhookSignature(
      payload,
      TEST_STRIPE_CONFIG.webhookSecret
    );

    const request = new NextRequest(
      "http://localhost:3000/api/onramp/webhook",
      {
        method: "POST",
        body: payload,
        headers: {
          "stripe-signature": signature,
        },
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(200);

    // Verify status was updated to failed in our mock
    const failedOnramp = mockOnramps.get(onramp.payment_intent_id);

    expect(failedOnramp?.status).toBe("failed");
    expect(failedOnramp?.error_message).toContain("declined");
  });

  it("should return 400 for missing signature", async () => {
    const { POST } = await import("@/app/api/onramp/webhook/route");

    const event = createPaymentIntentSucceededEvent(
      "pi_test_123",
      10000,
      "0x1234"
    );

    const request = new NextRequest(
      "http://localhost:3000/api/onramp/webhook",
      {
        method: "POST",
        body: JSON.stringify(event),
        headers: {
          // No stripe-signature header
        },
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("signature");
  });

  it("should return 400 for invalid signature", async () => {
    // Reset mock to throw on invalid signature
    const stripeMock = await import("@/lib/stripe");
    vi.mocked(stripeMock.verifyWebhookSignature).mockImplementationOnce(() => {
      throw new Error("Invalid signature");
    });

    const { POST } = await import("@/app/api/onramp/webhook/route");

    const event = createPaymentIntentSucceededEvent(
      "pi_test_123",
      10000,
      "0x1234"
    );

    const request = new NextRequest(
      "http://localhost:3000/api/onramp/webhook",
      {
        method: "POST",
        body: JSON.stringify(event),
        headers: {
          "stripe-signature": "invalid_signature",
        },
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Invalid signature");
  });

  it("should handle mint failure gracefully", async () => {
    // Make mint throw an error
    const tempoMock = await import("@/lib/tempo");
    vi.mocked(tempoMock.mintAcmeUsd).mockRejectedValueOnce(
      new Error("Mint failed: insufficient gas")
    );

    const { POST } = await import("@/app/api/onramp/webhook/route");
    const wallet = generateTestWallet();

    // Create mock onramp record
    const onramp = createMockOnramp({
      user_address: wallet.address.toLowerCase(),
      status: "pending",
    });

    const event = createPaymentIntentSucceededEvent(
      onramp.payment_intent_id,
      onramp.amount_usd,
      wallet.address
    );

    const payload = JSON.stringify(event);
    const signature = generateStripeWebhookSignature(
      payload,
      TEST_STRIPE_CONFIG.webhookSecret
    );

    const request = new NextRequest(
      "http://localhost:3000/api/onramp/webhook",
      {
        method: "POST",
        body: payload,
        headers: {
          "stripe-signature": signature,
        },
      }
    );

    // Webhook should still return 200 (async mint)
    const response = await POST(request);
    expect(response.status).toBe(200);

    // Allow async operation to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify status was updated to failed in our mock
    const failedOnramp = mockOnramps.get(onramp.payment_intent_id);

    expect(failedOnramp?.status).toBe("failed");
    expect(failedOnramp?.error_message).toContain("Mint failed");
  });
});

