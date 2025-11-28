import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  generateTestWallet,
} from "../../helpers/setup";

// Track mock state for database
let mockOfframps: Map<string, {
  id: string;
  memo: string;
  user_address: string;
  amount_usd: number;
  status: string;
  transfer_tx_hash: string | null;
  burn_tx_hash: string | null;
  stripe_payout_id: string | null;
  error_message: string | null;
}> = new Map();

let mockUsers: Map<string, {
  wallet_address: string;
  stripe_customer_id: string | null;
  stripe_bank_account_id: string | null;
}> = new Map();

// Mock tempo functions
vi.mock("@/lib/tempo", async () => {
  const actual = await vi.importActual("@/lib/tempo");
  return {
    ...actual,
    createTempoPublicClient: vi.fn(() => ({
      getTransactionReceipt: vi.fn(async () => ({
        status: "success",
        blockNumber: BigInt(12345),
        logs: [],
      })),
      getBlockNumber: vi.fn(async () => BigInt(12345)),
      getLogs: vi.fn(async () => []),
    })),
    burnAcmeUsd: vi.fn(async () => `0x${"burn".repeat(16)}`),
  };
});

// Mock stripe functions
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual("@/lib/stripe");
  return {
    ...actual,
    createStripeClient: vi.fn(() => ({})),
    createPayout: vi.fn(async (_stripe: unknown, amountCents: number, offrampId: string) => ({
      id: `po_demo_${Date.now()}_${offrampId.slice(0, 8)}`,
      amount: amountCents,
      status: "paid",
    })),
    getBankAccountDetails: vi.fn(async () => ({
      bankName: "Test Bank",
      last4: "1234",
      accountType: "checking",
    })),
  };
});

// Mock config
vi.mock("@/lib/config", async () => {
  const actual = await vi.importActual("@/lib/config");
  return {
    ...actual,
    config: {
      ...(actual as { config: object }).config,
      treasuryAddress: "0x1234567890123456789012345678901234567890",
      acmeUsdAddress: "0xabc0000000000000000000000000000000000000",
    },
  };
});

// Mock supabase
vi.mock("@/lib/supabase", () => ({
  createSupabaseClient: vi.fn(() => ({})),
  getOfframpById: vi.fn(async (_supabase: unknown, id: string) => {
    return mockOfframps.get(id) || null;
  }),
  updateOfframpStatus: vi.fn(async (_supabase: unknown, id: string, update: object) => {
    const existing = mockOfframps.get(id);
    if (existing) {
      const updated = { ...existing, ...update };
      mockOfframps.set(id, updated);
      return updated;
    }
    throw new Error("Record not found");
  }),
  getUserByAddress: vi.fn(async (_supabase: unknown, walletAddress: string) => {
    return mockUsers.get(walletAddress.toLowerCase()) || null;
  }),
}));

// Helper to create mock records
function createMockOfframp(overrides: {
  id?: string;
  memo?: string;
  user_address?: string;
  amount_usd?: number;
  status?: string;
  transfer_tx_hash?: string | null;
  burn_tx_hash?: string | null;
  stripe_payout_id?: string | null;
  error_message?: string | null;
} = {}) {
  const id = overrides.id ?? `offramp_${Date.now()}`;
  const record = {
    id,
    memo: overrides.memo ?? `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`,
    user_address: overrides.user_address ?? generateTestWallet().address.toLowerCase(),
    amount_usd: overrides.amount_usd ?? 5000,
    status: overrides.status ?? "pending",
    transfer_tx_hash: overrides.transfer_tx_hash ?? null,
    burn_tx_hash: overrides.burn_tx_hash ?? null,
    stripe_payout_id: overrides.stripe_payout_id ?? null,
    error_message: overrides.error_message ?? null,
  };
  mockOfframps.set(id, record);
  return record;
}

function createMockUser(overrides: {
  wallet_address?: string;
  stripe_customer_id?: string | null;
  stripe_bank_account_id?: string | null;
} = {}) {
  const wallet = generateTestWallet();
  const walletAddress = (overrides.wallet_address ?? wallet.address).toLowerCase();
  const record = {
    wallet_address: walletAddress,
    stripe_customer_id: overrides.stripe_customer_id ?? null,
    stripe_bank_account_id: overrides.stripe_bank_account_id ?? null,
  };
  mockUsers.set(walletAddress, record);
  return record;
}

describe("POST /api/offramp/process/:id", () => {
  beforeEach(async () => {
    mockOfframps.clear();
    mockUsers.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    mockOfframps.clear();
    mockUsers.clear();
  });

  it("should process offramp: verify transfer, burn tokens, create payout", async () => {
    const { POST } = await import("@/app/api/offramp/process/[id]/route");

    // Create mock user with bank account
    const user = createMockUser({
      stripe_customer_id: "cus_test_123",
      stripe_bank_account_id: "ba_test_123",
    });

    // Create mock pending offramp
    const offramp = createMockOfframp({
      user_address: user.wallet_address,
      status: "pending",
      amount_usd: 5000,
    });

    const txHash = `0x${"a".repeat(64)}`;

    const request = new NextRequest(
      `http://localhost:3000/api/offramp/process/${offramp.id}`,
      {
        method: "POST",
        body: JSON.stringify({ txHash }),
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: offramp.id }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.status).toBe("paid_out");
    expect(data.transferTxHash).toBe(txHash);
    expect(data.burnTxHash).toContain("burn");
    expect(data.payoutId).toContain("po_demo");

    // Verify mock was updated
    const updatedOfframp = mockOfframps.get(offramp.id);

    expect(updatedOfframp?.status).toBe("paid_out");
    expect(updatedOfframp?.transfer_tx_hash).toBe(txHash);
    expect(updatedOfframp?.burn_tx_hash).toContain("burn");
    expect(updatedOfframp?.stripe_payout_id).toContain("po_demo");
  });

  it("should return success with existing status for already processed offramp", async () => {
    const { POST } = await import("@/app/api/offramp/process/[id]/route");

    // Create mock already processed offramp
    const offramp = createMockOfframp({
      status: "paid_out",
      transfer_tx_hash: `0x${"x".repeat(64)}`,
      burn_tx_hash: `0x${"y".repeat(64)}`,
      stripe_payout_id: "po_existing_123",
    });

    const request = new NextRequest(
      `http://localhost:3000/api/offramp/process/${offramp.id}`,
      {
        method: "POST",
        body: JSON.stringify({ txHash: `0x${"z".repeat(64)}` }),
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: offramp.id }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.status).toBe("paid_out");
    expect(data.message).toBe("Already processed");
  });

  it("should return 400 for missing txHash", async () => {
    const { POST } = await import("@/app/api/offramp/process/[id]/route");

    const offramp = createMockOfframp({
      status: "pending",
    });

    const request = new NextRequest(
      `http://localhost:3000/api/offramp/process/${offramp.id}`,
      {
        method: "POST",
        // No body
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: offramp.id }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("transaction hash");
  });

  it("should return 404 for non-existent offramp", async () => {
    const { POST } = await import("@/app/api/offramp/process/[id]/route");

    const nonExistentId = "550e8400-e29b-41d4-a716-446655440000";

    const request = new NextRequest(
      `http://localhost:3000/api/offramp/process/${nonExistentId}`,
      {
        method: "POST",
        body: JSON.stringify({ txHash: `0x${"a".repeat(64)}` }),
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: nonExistentId }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain("not found");
  });

  it("should handle burn failure", async () => {
    // Mock burn to fail
    const tempoMock = await import("@/lib/tempo");
    vi.mocked(tempoMock.burnAcmeUsd).mockRejectedValueOnce(
      new Error("Burn failed: insufficient balance")
    );

    const { POST } = await import("@/app/api/offramp/process/[id]/route");

    const offramp = createMockOfframp({
      status: "pending",
      amount_usd: 5000,
    });

    const request = new NextRequest(
      `http://localhost:3000/api/offramp/process/${offramp.id}`,
      {
        method: "POST",
        body: JSON.stringify({ txHash: `0x${"a".repeat(64)}` }),
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: offramp.id }),
    });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toContain("Burn failed");

    // Verify mock was updated to failed
    const failedOfframp = mockOfframps.get(offramp.id);

    expect(failedOfframp?.status).toBe("failed");
    expect(failedOfframp?.error_message).toContain("Burn failed");
  });

  it("should handle reverted transaction", async () => {
    // Mock transaction receipt with failed status
    const tempoMock = await import("@/lib/tempo");
    vi.mocked(tempoMock.createTempoPublicClient).mockReturnValueOnce({
      getTransactionReceipt: vi.fn(async () => ({
        status: "reverted",
        blockNumber: BigInt(12345),
        logs: [],
      })),
      getBlockNumber: vi.fn(async () => BigInt(12345)),
      getLogs: vi.fn(async () => []),
    } as unknown as ReturnType<typeof tempoMock.createTempoPublicClient>);

    const { POST } = await import("@/app/api/offramp/process/[id]/route");

    const offramp = createMockOfframp({
      status: "pending",
    });

    const request = new NextRequest(
      `http://localhost:3000/api/offramp/process/${offramp.id}`,
      {
        method: "POST",
        body: JSON.stringify({ txHash: `0x${"reverted".repeat(8)}` }),
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: offramp.id }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("reverted");
  });
});

