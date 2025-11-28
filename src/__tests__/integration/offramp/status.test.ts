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
  created_at: string;
}> = new Map();

// Mock supabase
vi.mock("@/lib/supabase", () => ({
  createSupabaseClient: vi.fn(() => ({})),
  getOfframpById: vi.fn(async (_supabase: unknown, id: string) => {
    return mockOfframps.get(id) || null;
  }),
}));

// Helper to create a mock offramp record
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
    created_at: new Date().toISOString(),
  };
  mockOfframps.set(id, record);
  return record;
}

describe("GET /api/offramp/status/:id", () => {
  beforeEach(async () => {
    mockOfframps.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    mockOfframps.clear();
  });

  it("should return offramp status with all transaction hashes", async () => {
    const { GET } = await import("@/app/api/offramp/status/[id]/route");

    const transferTxHash = `0x${"transfer".repeat(8)}`;
    const burnTxHash = `0x${"burn".repeat(16)}`;
    const payoutId = "po_test_123";

    const offramp = createMockOfframp({
      status: "paid_out",
      amount_usd: 5000,
      transfer_tx_hash: transferTxHash,
      burn_tx_hash: burnTxHash,
      stripe_payout_id: payoutId,
    });

    const request = new NextRequest(
      `http://localhost:3000/api/offramp/status/${offramp.id}`
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: offramp.id }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.requestId).toBe(offramp.id);
    expect(data.status).toBe("paid_out");
    expect(data.amountUsd).toBe(50); // $50, converted from cents
    expect(data.transferTxHash).toBe(transferTxHash);
    expect(data.burnTxHash).toBe(burnTxHash);
    expect(data.payoutId).toBe(payoutId);
    expect(data.memo).toBe(offramp.memo);
  });

  it("should return 404 for non-existent offramp", async () => {
    const { GET } = await import("@/app/api/offramp/status/[id]/route");

    const nonExistentId = "550e8400-e29b-41d4-a716-446655440000";

    const request = new NextRequest(
      `http://localhost:3000/api/offramp/status/${nonExistentId}`
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: nonExistentId }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain("not found");
  });

  it("should return pending status for new offramp", async () => {
    const { GET } = await import("@/app/api/offramp/status/[id]/route");

    const offramp = createMockOfframp({
      status: "pending",
      amount_usd: 10000,
    });

    const request = new NextRequest(
      `http://localhost:3000/api/offramp/status/${offramp.id}`
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: offramp.id }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("pending");
    expect(data.amountUsd).toBe(100);
    expect(data.transferTxHash).toBeNull();
    expect(data.burnTxHash).toBeNull();
    expect(data.payoutId).toBeNull();
  });

  it("should return failed status with error message", async () => {
    const { GET } = await import("@/app/api/offramp/status/[id]/route");

    const offramp = createMockOfframp({
      status: "failed",
      error_message: "Burn failed: insufficient balance",
      transfer_tx_hash: `0x${"t".repeat(64)}`,
    });

    const request = new NextRequest(
      `http://localhost:3000/api/offramp/status/${offramp.id}`
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: offramp.id }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("failed");
    expect(data.errorMessage).toContain("Burn failed");
    expect(data.transferTxHash).toBe(`0x${"t".repeat(64)}`);
  });

  it("should return all expected fields", async () => {
    const { GET } = await import("@/app/api/offramp/status/[id]/route");

    const offramp = createMockOfframp({
      status: "transferred",
      transfer_tx_hash: `0x${"a".repeat(64)}`,
    });

    const request = new NextRequest(
      `http://localhost:3000/api/offramp/status/${offramp.id}`
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: offramp.id }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);

    // Verify all expected fields are present
    expect(data).toHaveProperty("requestId");
    expect(data).toHaveProperty("memo");
    expect(data).toHaveProperty("userAddress");
    expect(data).toHaveProperty("amountUsd");
    expect(data).toHaveProperty("status");
    expect(data).toHaveProperty("transferTxHash");
    expect(data).toHaveProperty("burnTxHash");
    expect(data).toHaveProperty("payoutId");
    expect(data).toHaveProperty("errorMessage");
    expect(data).toHaveProperty("createdAt");
  });

  it("should return intermediate status (burning)", async () => {
    const { GET } = await import("@/app/api/offramp/status/[id]/route");

    const offramp = createMockOfframp({
      status: "burning",
      transfer_tx_hash: `0x${"b".repeat(64)}`,
    });

    const request = new NextRequest(
      `http://localhost:3000/api/offramp/status/${offramp.id}`
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: offramp.id }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("burning");
    expect(data.transferTxHash).toBe(`0x${"b".repeat(64)}`);
    expect(data.burnTxHash).toBeNull();
  });

  it("should return burned status", async () => {
    const { GET } = await import("@/app/api/offramp/status/[id]/route");

    const offramp = createMockOfframp({
      status: "burned",
      transfer_tx_hash: `0x${"c".repeat(64)}`,
      burn_tx_hash: `0x${"d".repeat(64)}`,
    });

    const request = new NextRequest(
      `http://localhost:3000/api/offramp/status/${offramp.id}`
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: offramp.id }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("burned");
    expect(data.transferTxHash).toBe(`0x${"c".repeat(64)}`);
    expect(data.burnTxHash).toBe(`0x${"d".repeat(64)}`);
    expect(data.payoutId).toBeNull();
  });
});

