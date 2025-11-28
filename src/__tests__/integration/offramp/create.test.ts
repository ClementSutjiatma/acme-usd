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
}> = new Map();

// Mock config to provide treasury address
vi.mock("@/lib/config", async () => {
  const actual = await vi.importActual("@/lib/config");
  return {
    ...actual,
    config: {
      ...(actual as { config: object }).config,
      treasuryAddress: "0x1234567890123456789012345678901234567890",
    },
  };
});

// Mock supabase
vi.mock("@/lib/supabase", () => ({
  createSupabaseClient: vi.fn(() => ({})),
  createOfframpRecord: vi.fn(async (_supabase: unknown, data: {
    memo: string;
    user_address: string;
    amount_usd: number;
  }) => {
    const record = {
      id: `offramp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      memo: data.memo,
      user_address: data.user_address.toLowerCase(),
      amount_usd: data.amount_usd,
      status: "pending",
    };
    mockOfframps.set(record.id, record);
    return record;
  }),
}));

describe("POST /api/offramp/create", () => {
  beforeEach(async () => {
    mockOfframps.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    mockOfframps.clear();
  });

  it("should generate unique memo and store in database", async () => {
    const { POST } = await import("@/app/api/offramp/create/route");
    const wallet = generateTestWallet();

    const request = new NextRequest(
      "http://localhost:3000/api/offramp/create",
      {
        method: "POST",
        body: JSON.stringify({
          userAddress: wallet.address,
          amountUsd: 50,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.memo).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(data.requestId).toBeDefined();

    // Verify mock database record
    const offramp = mockOfframps.get(data.requestId);

    expect(offramp).toBeDefined();
    expect(offramp?.memo).toBe(data.memo);
    expect(offramp?.status).toBe("pending");
  });

  it("should return treasury address and instructions", async () => {
    const { POST } = await import("@/app/api/offramp/create/route");
    const wallet = generateTestWallet();

    const request = new NextRequest(
      "http://localhost:3000/api/offramp/create",
      {
        method: "POST",
        body: JSON.stringify({
          userAddress: wallet.address,
          amountUsd: 100,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.treasuryAddress).toBe(
      "0x1234567890123456789012345678901234567890"
    );
    expect(data.instructions).toContain("Send");
    expect(data.instructions).toContain("100");
    expect(data.instructions).toContain(data.memo);
    expect(data.amountUsd).toBe(100);
  });

  it("should reject invalid wallet address", async () => {
    const { POST } = await import("@/app/api/offramp/create/route");

    const testCases = [
      { userAddress: "", amountUsd: 50 },
      { userAddress: null, amountUsd: 50 },
      { userAddress: 123, amountUsd: 50 },
      { amountUsd: 50 }, // Missing userAddress
    ];

    for (const testCase of testCases) {
      const request = new NextRequest(
        "http://localhost:3000/api/offramp/create",
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

  it("should reject invalid amount", async () => {
    const { POST } = await import("@/app/api/offramp/create/route");
    const wallet = generateTestWallet();

    const testCases = [
      { userAddress: wallet.address, amountUsd: 0 },
      { userAddress: wallet.address, amountUsd: -50 },
      { userAddress: wallet.address, amountUsd: "invalid" },
      { userAddress: wallet.address, amountUsd: null },
      { userAddress: wallet.address }, // Missing amount
    ];

    for (const testCase of testCases) {
      const request = new NextRequest(
        "http://localhost:3000/api/offramp/create",
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

  it("should store correct amount in cents", async () => {
    const { POST } = await import("@/app/api/offramp/create/route");
    const wallet = generateTestWallet();

    const request = new NextRequest(
      "http://localhost:3000/api/offramp/create",
      {
        method: "POST",
        body: JSON.stringify({
          userAddress: wallet.address,
          amountUsd: 123.45, // Decimal amount
        }),
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);

    // Verify amount stored in cents in mock
    const offramp = mockOfframps.get(data.requestId);

    expect(offramp?.amount_usd).toBe(12345); // $123.45 in cents
  });

  it("should generate different memos for concurrent requests", async () => {
    const { POST } = await import("@/app/api/offramp/create/route");
    const wallet = generateTestWallet();

    // Create multiple requests concurrently
    const requests = Array.from({ length: 5 }, () =>
      new NextRequest("http://localhost:3000/api/offramp/create", {
        method: "POST",
        body: JSON.stringify({
          userAddress: wallet.address,
          amountUsd: 50,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      })
    );

    const responses = await Promise.all(requests.map((req) => POST(req)));
    const results = await Promise.all(responses.map((r) => r.json()));

    // All should succeed
    responses.forEach((r) => expect(r.status).toBe(200));

    // All memos should be unique
    const memos = results.map((r) => r.memo);
    const uniqueMemos = new Set(memos);
    expect(uniqueMemos.size).toBe(memos.length);
  });
});

