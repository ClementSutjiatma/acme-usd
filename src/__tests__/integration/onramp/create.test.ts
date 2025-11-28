import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  generateTestWallet,
} from "../../helpers/setup";

// Track mock state for database
let mockUsers: Map<string, {
  id: string;
  wallet_address: string;
  stripe_customer_id: string | null;
  stripe_bank_account_id: string | null;
}> = new Map();

let mockOnramps: Map<string, {
  id: string;
  payment_intent_id: string;
  user_address: string;
  amount_usd: number;
  status: string;
}> = new Map();

// Counter for unique IDs in stripe
let stripeIdCounter = 0;

// Mock Stripe client
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual("@/lib/stripe");
  return {
    ...actual,
    createStripeClient: vi.fn(() => ({})),
    getOrCreateCustomer: vi.fn(async (_stripe: unknown, walletAddress: string, existingCustomerId?: string | null) => ({
      id: existingCustomerId || `cus_test_${Date.now()}_${++stripeIdCounter}`,
      metadata: { walletAddress },
    })),
    createPaymentIntent: vi.fn(async (_stripe: unknown, amountCents: number, userAddress: string, customerId?: string) => {
      const uniqueId = `pi_test_${Date.now()}_${++stripeIdCounter}`;
      return {
        id: uniqueId,
        client_secret: `${uniqueId}_secret_test`,
        amount: amountCents,
        currency: "usd",
        customer: customerId,
        metadata: { userAddress, type: "onramp" },
      };
    }),
  };
});

// Counter for unique IDs
let idCounter = 0;

// Mock supabase
vi.mock("@/lib/supabase", () => ({
  createSupabaseClient: vi.fn(() => ({})),
  getOrCreateUser: vi.fn(async (_supabase: unknown, walletAddress: string) => {
    const normalized = walletAddress.toLowerCase();
    let user = mockUsers.get(normalized);
    if (!user) {
      user = {
        id: `user_${++idCounter}`,
        wallet_address: normalized,
        stripe_customer_id: null,
        stripe_bank_account_id: null,
      };
      mockUsers.set(normalized, user);
    }
    return user;
  }),
  updateUserStripeCustomer: vi.fn(async (_supabase: unknown, walletAddress: string, stripeCustomerId: string) => {
    const normalized = walletAddress.toLowerCase();
    const user = mockUsers.get(normalized);
    if (user) {
      user.stripe_customer_id = stripeCustomerId;
      mockUsers.set(normalized, user);
    }
    return user;
  }),
  createOnrampRecord: vi.fn(async (_supabase: unknown, data: {
    payment_intent_id: string;
    user_address: string;
    amount_usd: number;
  }) => {
    const record = {
      id: `onramp_${++idCounter}`,
      payment_intent_id: data.payment_intent_id,
      user_address: data.user_address.toLowerCase(),
      amount_usd: data.amount_usd,
      status: "pending",
    };
    mockOnramps.set(data.payment_intent_id, record);
    return record;
  }),
}));

describe("POST /api/onramp/create", () => {
  beforeEach(async () => {
    mockUsers.clear();
    mockOnramps.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    mockUsers.clear();
    mockOnramps.clear();
  });

  it("should create a PaymentIntent with correct amount and metadata", async () => {
    const { POST } = await import("@/app/api/onramp/create/route");
    const wallet = generateTestWallet();

    const request = new NextRequest("http://localhost:3000/api/onramp/create", {
      method: "POST",
      body: JSON.stringify({
        userAddress: wallet.address,
        amountUsd: 100,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.clientSecret).toBeDefined();
    expect(data.paymentIntentId).toMatch(/^pi_test_/);
  });

  it("should store onramp record in database with pending status", async () => {
    const { POST } = await import("@/app/api/onramp/create/route");
    const wallet = generateTestWallet();

    const request = new NextRequest("http://localhost:3000/api/onramp/create", {
      method: "POST",
      body: JSON.stringify({
        userAddress: wallet.address,
        amountUsd: 50,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);

    // Verify mock database record was created
    const onramp = mockOnramps.get(data.paymentIntentId);

    expect(onramp).toBeDefined();
    expect(onramp?.status).toBe("pending");
    expect(onramp?.user_address).toBe(wallet.address.toLowerCase());
    expect(onramp?.amount_usd).toBe(5000); // $50 in cents
  });

  it("should create or link Stripe Customer to wallet address", async () => {
    const { POST } = await import("@/app/api/onramp/create/route");
    const wallet = generateTestWallet();

    const request = new NextRequest("http://localhost:3000/api/onramp/create", {
      method: "POST",
      body: JSON.stringify({
        userAddress: wallet.address,
        amountUsd: 25,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    await POST(request);

    // Verify mock user record was created with Stripe customer ID
    const user = mockUsers.get(wallet.address.toLowerCase());

    expect(user).toBeDefined();
    expect(user?.stripe_customer_id).toMatch(/^cus_test_/);
  });

  it("should reject invalid wallet address", async () => {
    const { POST } = await import("@/app/api/onramp/create/route");

    const testCases = [
      { userAddress: "", amountUsd: 100 },
      { userAddress: null, amountUsd: 100 },
      { userAddress: 123, amountUsd: 100 },
      { amountUsd: 100 }, // Missing userAddress
    ];

    for (const testCase of testCases) {
      const request = new NextRequest(
        "http://localhost:3000/api/onramp/create",
        {
          method: "POST",
          body: JSON.stringify(testCase),
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    }
  });

  it("should reject invalid/zero/negative amount", async () => {
    const { POST } = await import("@/app/api/onramp/create/route");
    const wallet = generateTestWallet();

    const testCases = [
      { userAddress: wallet.address, amountUsd: 0 },
      { userAddress: wallet.address, amountUsd: -100 },
      { userAddress: wallet.address, amountUsd: "invalid" },
      { userAddress: wallet.address, amountUsd: null },
      { userAddress: wallet.address }, // Missing amount
    ];

    for (const testCase of testCases) {
      const request = new NextRequest(
        "http://localhost:3000/api/onramp/create",
        {
          method: "POST",
          body: JSON.stringify(testCase),
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    }
  });

  it("should handle concurrent requests from same user", async () => {
    const { POST } = await import("@/app/api/onramp/create/route");
    const wallet = generateTestWallet();

    // Create multiple requests concurrently
    const requests = Array.from({ length: 3 }, () =>
      new NextRequest("http://localhost:3000/api/onramp/create", {
        method: "POST",
        body: JSON.stringify({
          userAddress: wallet.address,
          amountUsd: 100,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      })
    );

    const responses = await Promise.all(requests.map((req) => POST(req)));

    // All requests should succeed
    for (const response of responses) {
      expect(response.status).toBe(200);
    }

    // Should create multiple onramp records in our mock
    const onrampCount = Array.from(mockOnramps.values()).filter(
      (o) => o.user_address === wallet.address.toLowerCase()
    ).length;

    expect(onrampCount).toBe(3);
  });
});

