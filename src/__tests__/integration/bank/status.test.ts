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

// Mock stripe functions
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual("@/lib/stripe");
  return {
    ...actual,
    createStripeClient: vi.fn(() => ({})),
    getBankAccountDetails: vi.fn(async (
      _stripe: unknown,
      accountId: string
    ) => {
      if (accountId === "ba_not_found") {
        return null;
      }
      return {
        bankName: "Test Bank",
        last4: "1234",
        accountType: "checking",
      };
    }),
  };
});

// Mock supabase
vi.mock("@/lib/supabase", () => ({
  createSupabaseClient: vi.fn(() => ({})),
  getUserByAddress: vi.fn(async (_supabase: unknown, walletAddress: string) => {
    return mockUsers.get(walletAddress.toLowerCase()) || null;
  }),
}));

// Helper to create mock user
function createMockUser(overrides: {
  wallet_address?: string;
  stripe_customer_id?: string | null;
  stripe_bank_account_id?: string | null;
} = {}) {
  const wallet = generateTestWallet();
  const walletAddress = (overrides.wallet_address ?? wallet.address).toLowerCase();
  const record = {
    id: `user_${Date.now()}`,
    wallet_address: walletAddress,
    stripe_customer_id: overrides.stripe_customer_id ?? null,
    stripe_bank_account_id: overrides.stripe_bank_account_id ?? null,
  };
  mockUsers.set(walletAddress, record);
  return record;
}

describe("GET /api/bank/status", () => {
  beforeEach(async () => {
    mockUsers.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    mockUsers.clear();
  });

  it("should return bank account details when linked", async () => {
    const { GET } = await import("@/app/api/bank/status/route");

    // Create mock user with bank account
    const user = createMockUser({
      stripe_customer_id: "cus_test_123",
      stripe_bank_account_id: "ba_test_123",
    });

    const request = new NextRequest(
      `http://localhost:3000/api/bank/status?address=${user.wallet_address}`
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.hasBankAccount).toBe(true);
    expect(data.bankAccount).toBeDefined();
    expect(data.bankAccount.bankName).toBe("Test Bank");
    expect(data.bankAccount.last4).toBe("1234");
    expect(data.bankAccount.accountType).toBe("checking");
  });

  it("should return hasBankAccount: false when not linked", async () => {
    const { GET } = await import("@/app/api/bank/status/route");

    // Create mock user without bank account
    const user = createMockUser({
      stripe_customer_id: "cus_test_456",
      stripe_bank_account_id: null,
    });

    const request = new NextRequest(
      `http://localhost:3000/api/bank/status?address=${user.wallet_address}`
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.hasBankAccount).toBe(false);
    expect(data.bankAccount).toBeNull();
  });

  it("should return hasBankAccount: false when user not found", async () => {
    const { GET } = await import("@/app/api/bank/status/route");

    const wallet = generateTestWallet();

    const request = new NextRequest(
      `http://localhost:3000/api/bank/status?address=${wallet.address}`
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.hasBankAccount).toBe(false);
    expect(data.bankAccount).toBeNull();
  });

  it("should return 400 for missing wallet address", async () => {
    const { GET } = await import("@/app/api/bank/status/route");

    const request = new NextRequest(
      "http://localhost:3000/api/bank/status"
      // No address parameter
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("address");
  });

  it("should handle bank account lookup failure gracefully", async () => {
    const { GET } = await import("@/app/api/bank/status/route");

    // Create mock user with bank account that will return null
    const user = createMockUser({
      stripe_customer_id: "cus_test_789",
      stripe_bank_account_id: "ba_not_found",
    });

    const request = new NextRequest(
      `http://localhost:3000/api/bank/status?address=${user.wallet_address}`
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.hasBankAccount).toBe(true);
    expect(data.bankAccount).toBeNull();
  });

  it("should normalize wallet address to lowercase", async () => {
    const { GET } = await import("@/app/api/bank/status/route");

    // Create mock user with lowercase address
    const user = createMockUser({
      stripe_bank_account_id: "ba_test_lower",
    });

    // Query with mixed case
    const mixedCaseAddress =
      user.wallet_address.slice(0, 10).toUpperCase() +
      user.wallet_address.slice(10);

    const request = new NextRequest(
      `http://localhost:3000/api/bank/status?address=${mixedCaseAddress}`
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.hasBankAccount).toBe(true);
  });
});

