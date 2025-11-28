import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  generateTestWallet,
} from "../../helpers/setup";

// Track mock state for database
let mockOnramps: Map<string, {
  id: string;
  payment_intent_id: string;
  user_address: string;
  amount_usd: number;
  status: string;
  mint_tx_hash: string | null;
  error_message: string | null;
  created_at: string;
}> = new Map();

// Mock supabase
vi.mock("@/lib/supabase", () => ({
  createSupabaseClient: vi.fn(() => ({})),
  getOnrampByPaymentIntent: vi.fn(async (_supabase: unknown, paymentIntentId: string) => {
    return mockOnramps.get(paymentIntentId) || null;
  }),
}));

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
    created_at: new Date().toISOString(),
  };
  mockOnramps.set(paymentIntentId, record);
  return record;
}

describe("GET /api/onramp/status/:id", () => {
  beforeEach(async () => {
    mockOnramps.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    mockOnramps.clear();
  });

  it("should return current onramp status", async () => {
    const { GET } = await import("@/app/api/onramp/status/[id]/route");

    // Create mock onramp record
    const onramp = createMockOnramp({
      status: "pending",
      amount_usd: 10000,
    });

    const request = new NextRequest(
      `http://localhost:3000/api/onramp/status/${onramp.payment_intent_id}`
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: onramp.payment_intent_id }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.paymentIntentId).toBe(onramp.payment_intent_id);
    expect(data.status).toBe("pending");
    expect(data.amountUsd).toBe(100); // Converted from cents
    expect(data.mintTxHash).toBeNull();
  });

  it("should return status with transaction hash when minted", async () => {
    const { GET } = await import("@/app/api/onramp/status/[id]/route");

    const mintTxHash = `0x${"abc123".repeat(10)}def`;

    // Create mock minted onramp record
    const onramp = createMockOnramp({
      status: "minted",
      mint_tx_hash: mintTxHash,
      amount_usd: 5000,
    });

    const request = new NextRequest(
      `http://localhost:3000/api/onramp/status/${onramp.payment_intent_id}`
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: onramp.payment_intent_id }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("minted");
    expect(data.mintTxHash).toBe(mintTxHash);
    expect(data.amountUsd).toBe(50);
  });

  it("should return failed status with error message", async () => {
    const { GET } = await import("@/app/api/onramp/status/[id]/route");

    // Create mock failed onramp record
    const onramp = createMockOnramp({
      status: "failed",
      error_message: "Payment declined",
    });

    const request = new NextRequest(
      `http://localhost:3000/api/onramp/status/${onramp.payment_intent_id}`
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: onramp.payment_intent_id }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("failed");
    expect(data.errorMessage).toBe("Payment declined");
  });

  it("should return pending for non-existent payment intent", async () => {
    const { GET } = await import("@/app/api/onramp/status/[id]/route");

    const nonExistentId = "pi_nonexistent_123";

    const request = new NextRequest(
      `http://localhost:3000/api/onramp/status/${nonExistentId}`
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: nonExistentId }),
    });
    const data = await response.json();

    // Returns pending status for race condition handling
    expect(response.status).toBe(200);
    expect(data.status).toBe("pending");
    expect(data.id).toBeNull();
    expect(data.paymentIntentId).toBe(nonExistentId);
  });

  it("should return all expected fields", async () => {
    const { GET } = await import("@/app/api/onramp/status/[id]/route");

    const onramp = createMockOnramp({
      status: "minted",
      mint_tx_hash: `0x${"d".repeat(64)}`,
      amount_usd: 25000,
    });

    const request = new NextRequest(
      `http://localhost:3000/api/onramp/status/${onramp.payment_intent_id}`
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: onramp.payment_intent_id }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);

    // Verify all expected fields are present
    expect(data).toHaveProperty("id");
    expect(data).toHaveProperty("paymentIntentId");
    expect(data).toHaveProperty("userAddress");
    expect(data).toHaveProperty("amountUsd");
    expect(data).toHaveProperty("status");
    expect(data).toHaveProperty("mintTxHash");
    expect(data).toHaveProperty("errorMessage");
    expect(data).toHaveProperty("createdAt");
  });

  it("should handle minting status", async () => {
    const { GET } = await import("@/app/api/onramp/status/[id]/route");

    // Create mock onramp in minting state (mint in progress)
    const onramp = createMockOnramp({
      status: "minting",
    });

    const request = new NextRequest(
      `http://localhost:3000/api/onramp/status/${onramp.payment_intent_id}`
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: onramp.payment_intent_id }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("minting");
  });
});

