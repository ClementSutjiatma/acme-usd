import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Mock the tempo.ts modules
vi.mock("tempo.ts/ox", () => ({
  TransactionEnvelopeAA: {
    deserialize: vi.fn(() => ({
      chainId: 1,
      nonce: BigInt(1),
      gas: BigInt(21000),
      maxFeePerGas: BigInt(1000000000),
      feeToken: "0x20c0000000000000000000000000000000000001",
      signature: { type: "webAuthn" },
      calls: [],
    })),
    getFeePayerSignPayload: vi.fn(() => "0xpayload"),
    from: vi.fn((envelope) => ({
      ...envelope,
      feePayerSignature: { r: BigInt(1), s: BigInt(1), yParity: 0 },
    })),
    serialize: vi.fn(() => "0x76serializedtx"),
  },
}));

// Mock ox modules
vi.mock("ox/Hex", () => ({
  slice: vi.fn((hex: string, start: number, end?: number) => {
    if (end === undefined) {
      return hex.slice(2 + start * 2);
    }
    if (end < 0) {
      return hex.slice(2 + start * 2, end * 2);
    }
    return hex.slice(2 + start * 2, 2 + end * 2);
  }),
}));

vi.mock("ox/Secp256k1", () => ({
  sign: vi.fn(() => ({
    r: BigInt(1),
    s: BigInt(1),
    yParity: 0,
  })),
  recoverAddress: vi.fn(() => "0x1234567890123456789012345678901234567890"),
}));

// Mock config with required values
vi.mock("@/lib/config", () => ({
  config: {
    backendPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234",
    alphaUsdAddress: "0x20c0000000000000000000000000000000000001",
    tempoRpcBaseUrl: "https://rpc.testnet.tempo.xyz",
    tempoRpcAuth: undefined,
  },
}));

// Mock viem
vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    createClient: vi.fn(() => ({
      request: vi.fn(async () => "0xtxhash123"),
    })),
  };
});

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: "0x1234567890123456789012345678901234567890",
    signTransaction: vi.fn(),
  })),
}));

vi.mock("tempo.ts/chains", () => ({
  tempo: vi.fn(() => ({
    id: 1,
    name: "Tempo Testnet",
  })),
}));

describe("POST /api/sponsor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("should forward non-marker transactions to RPC", async () => {
    // Set up mock for this specific test
    const hexMock = await import("ox/Hex");
    vi.mocked(hexMock.slice).mockImplementation((hex: string, start: number, end?: number) => {
      if (start === -6 && end === undefined) {
        return "0x000000000000"; // Not the marker
      }
      if (start === 0 && end === 1) {
        return "0x76"; // AA transaction type
      }
      return "0x";
    });

    const { POST } = await import("@/app/api/sponsor/route");

    const serializedTx = `0x76${"00".repeat(100)}`;

    const request = new NextRequest("http://localhost:3000/api/sponsor", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: [serializedTx],
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.result).toBeDefined();
  });

  it("should sign and broadcast fee-sponsored transactions", async () => {
    // Set up mock for marker detection
    const hexMock = await import("ox/Hex");
    vi.mocked(hexMock.slice).mockImplementation((hex: string, start: number, end?: number) => {
      if (start === -6 && end === undefined) {
        return "0xfeefeefeefee"; // Has the marker
      }
      if (start === 0 && end === 1) {
        return "0x76"; // AA transaction type
      }
      if (start === -26 && end === -6) {
        return "0xabcd567890123456789012345678901234567890"; // Sender address
      }
      return `0x${"00".repeat(20)}`;
    });

    const { POST } = await import("@/app/api/sponsor/route");

    // Transaction with feefeefeefee marker
    const senderAddress = "abcd567890123456789012345678901234567890";
    const marker = "feefeefeefee";
    const serializedTx = `0x76${"00".repeat(80)}${senderAddress}${marker}`;

    const request = new NextRequest("http://localhost:3000/api/sponsor", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: [serializedTx],
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.jsonrpc).toBe("2.0");
    expect(data.result).toBeDefined();
  });

  it("should reject unsupported RPC methods", async () => {
    const { POST } = await import("@/app/api/sponsor/route");

    const request = new NextRequest("http://localhost:3000/api/sponsor", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: ["0x123", "latest"],
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("not supported");
  });

  it("should handle eth_sendRawTransactionSync method", async () => {
    const hexMock = await import("ox/Hex");
    vi.mocked(hexMock.slice).mockImplementation((hex: string, start: number, end?: number) => {
      if (start === -6 && end === undefined) {
        return "0x000000000000"; // Not the marker
      }
      if (start === 0 && end === 1) {
        return "0x76";
      }
      return "0x";
    });

    const { POST } = await import("@/app/api/sponsor/route");

    const serializedTx = `0x76${"00".repeat(100)}`;

    const request = new NextRequest("http://localhost:3000/api/sponsor", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransactionSync",
        params: [serializedTx],
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.result).toBeDefined();
  });

  it("should return JSON-RPC error format on failure", async () => {
    const { POST } = await import("@/app/api/sponsor/route");

    // Send invalid JSON
    const request = new NextRequest("http://localhost:3000/api/sponsor", {
      method: "POST",
      body: "invalid json",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.jsonrpc).toBe("2.0");
    expect(data.error).toBeDefined();
    expect(data.error.code).toBeDefined();
    expect(data.error.message).toBeDefined();
  });

  it("should handle signing errors gracefully", async () => {
    // Set up mock to throw error during signing
    const hexMock = await import("ox/Hex");
    vi.mocked(hexMock.slice).mockImplementation((hex: string, start: number, end?: number) => {
      if (start === -6 && end === undefined) {
        return "0xfeefeefeefee"; // Has marker
      }
      if (start === 0 && end === 1) {
        return "0x76";
      }
      if (start === -26 && end === -6) {
        return "0x1234567890123456789012345678901234567890";
      }
      return "0x";
    });

    const tempoOx = await import("tempo.ts/ox");
    vi.mocked(tempoOx.TransactionEnvelopeAA.deserialize).mockImplementationOnce(
      () => {
        throw new Error("Failed to deserialize transaction");
      }
    );

    const { POST } = await import("@/app/api/sponsor/route");

    const senderAddress = "1234567890123456789012345678901234567890";
    const marker = "feefeefeefee";
    const serializedTx = `0x76${"00".repeat(80)}${senderAddress}${marker}`;

    const request = new NextRequest("http://localhost:3000/api/sponsor", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: [serializedTx],
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("deserialize");
  });
});

