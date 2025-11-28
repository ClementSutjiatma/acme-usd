import { describe, it, expect } from "vitest";
import { generateMemo } from "@/lib/blockchain";
import { keccak256, toBytes } from "viem";

describe("generateMemo", () => {
  it("should produce a valid 32-byte keccak256 hash", () => {
    const requestId = "test-request-123";
    const memo = generateMemo(requestId);

    // Should be a hex string starting with 0x
    expect(memo).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Should be 32 bytes (64 hex characters after 0x)
    expect(memo.length).toBe(66); // 0x + 64 chars
  });

  it("should be deterministic for the same input", () => {
    const requestId = "deterministic-test";

    const memo1 = generateMemo(requestId);
    const memo2 = generateMemo(requestId);

    expect(memo1).toBe(memo2);
  });

  it("should produce different memos for different inputs", () => {
    const memo1 = generateMemo("request-1");
    const memo2 = generateMemo("request-2");
    const memo3 = generateMemo("request-3");

    expect(memo1).not.toBe(memo2);
    expect(memo2).not.toBe(memo3);
    expect(memo1).not.toBe(memo3);
  });

  it("should match expected keccak256 output", () => {
    const requestId = "known-input";
    const memo = generateMemo(requestId);

    // Manually compute expected hash
    const expected = keccak256(toBytes(requestId));

    expect(memo).toBe(expected);
  });

  it("should handle empty string input", () => {
    const memo = generateMemo("");

    // Should still produce a valid hash
    expect(memo).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Empty string keccak256 is a known value
    const expectedEmpty = keccak256(toBytes(""));
    expect(memo).toBe(expectedEmpty);
  });

  it("should handle special characters", () => {
    const requestId = "request-with-special-chars!@#$%^&*()";
    const memo = generateMemo(requestId);

    expect(memo).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  it("should handle UUID-style inputs", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const memo = generateMemo(uuid);

    expect(memo).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  it("should handle long inputs", () => {
    const longInput = "a".repeat(1000);
    const memo = generateMemo(longInput);

    // Hash should still be 32 bytes regardless of input length
    expect(memo).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(memo.length).toBe(66);
  });
});

