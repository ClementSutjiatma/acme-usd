import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("config parsing", () => {
  // Store original env values
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset module cache to re-evaluate config
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe("RPC URL parsing", () => {
    it("should extract credentials from URL with auth", async () => {
      process.env.TEMPO_RPC_URL =
        "https://user:password@rpc.testnet.tempo.xyz";

      // Re-import to get fresh config
      const { config } = await import("@/lib/config");

      expect(config.tempoRpcBaseUrl).toBe("https://rpc.testnet.tempo.xyz/");
      expect(config.tempoRpcAuth).toBe(
        Buffer.from("user:password").toString("base64")
      );
    });

    it("should handle URL without credentials", async () => {
      process.env.TEMPO_RPC_URL = "https://rpc.testnet.tempo.xyz";

      const { config } = await import("@/lib/config");

      expect(config.tempoRpcBaseUrl).toBe("https://rpc.testnet.tempo.xyz");
      expect(config.tempoRpcAuth).toBeUndefined();
    });

    it("should handle complex username:password combinations", async () => {
      process.env.TEMPO_RPC_URL =
        "https://dreamy-northcutt:recursing-payne@rpc.testnet.tempo.xyz";

      const { config } = await import("@/lib/config");

      expect(config.tempoRpcBaseUrl).toBe("https://rpc.testnet.tempo.xyz/");
      expect(config.tempoRpcAuth).toBe(
        Buffer.from("dreamy-northcutt:recursing-payne").toString("base64")
      );
    });

    it("should preserve path in URL", async () => {
      process.env.TEMPO_RPC_URL =
        "https://user:pass@rpc.testnet.tempo.xyz/v1/endpoint";

      const { config } = await import("@/lib/config");

      expect(config.tempoRpcBaseUrl).toBe(
        "https://rpc.testnet.tempo.xyz/v1/endpoint"
      );
    });

    it("should use default RPC URL when not specified", async () => {
      delete process.env.TEMPO_RPC_URL;

      const { config } = await import("@/lib/config");

      // Should fall back to testnet URL with default credentials
      expect(config.tempoRpcUrl).toContain("rpc.testnet.tempo.xyz");
    });
  });

  describe("contract addresses", () => {
    it("should use provided ACME_USD_ADDRESS", async () => {
      const testAddress = "0x1234567890123456789012345678901234567890";
      process.env.ACME_USD_ADDRESS = testAddress;

      const { config } = await import("@/lib/config");

      expect(config.acmeUsdAddress).toBe(testAddress);
    });

    it("should handle undefined ACME_USD_ADDRESS", async () => {
      delete process.env.ACME_USD_ADDRESS;

      const { config } = await import("@/lib/config");

      expect(config.acmeUsdAddress).toBeUndefined();
    });

    it("should have correct default token addresses", async () => {
      const { config } = await import("@/lib/config");

      expect(config.linkingUsdAddress).toBe(
        "0x20c0000000000000000000000000000000000000"
      );
      expect(config.alphaUsdAddress).toBe(
        "0x20c0000000000000000000000000000000000001"
      );
      expect(config.tip20FactoryAddress).toBe(
        "0x20Fc000000000000000000000000000000000000"
      );
    });
  });

  describe("Stripe configuration", () => {
    it("should read Stripe keys from environment", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
      process.env.NEXT_PUBLIC_STRIPE_KEY = "pk_test_123";

      const { config } = await import("@/lib/config");

      expect(config.stripeSecretKey).toBe("sk_test_123");
      expect(config.stripeWebhookSecret).toBe("whsec_123");
      expect(config.stripePublicKey).toBe("pk_test_123");
    });

    it("should default to empty strings when not set", async () => {
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.NEXT_PUBLIC_STRIPE_KEY;

      const { config } = await import("@/lib/config");

      expect(config.stripeSecretKey).toBe("");
      expect(config.stripeWebhookSecret).toBe("");
      expect(config.stripePublicKey).toBe("");
    });
  });

  describe("Supabase configuration", () => {
    it("should read Supabase URL and key from environment", async () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SECRET_KEY = "secret_key_123";

      const { config } = await import("@/lib/config");

      expect(config.supabaseUrl).toBe("https://test.supabase.co");
      expect(config.supabaseSecretKey).toBe("secret_key_123");
    });
  });

  describe("backend wallet", () => {
    it("should read private key from environment", async () => {
      const testKey =
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      process.env.BACKEND_PRIVATE_KEY = testKey;

      const { config } = await import("@/lib/config");

      expect(config.backendPrivateKey).toBe(testKey);
    });

    it("should handle undefined private key", async () => {
      delete process.env.BACKEND_PRIVATE_KEY;

      const { config } = await import("@/lib/config");

      expect(config.backendPrivateKey).toBeUndefined();
    });
  });

  describe("public config", () => {
    it("should have correct public values", async () => {
      const { publicConfig } = await import("@/lib/config");

      // Public config should not expose credentials
      expect(publicConfig.tempoRpcBaseUrl).toBe(
        "https://rpc.testnet.tempo.xyz"
      );
      expect(publicConfig.alphaUsdAddress).toBe(
        "0x20c0000000000000000000000000000000000001"
      );
      expect(publicConfig.explorerUrl).toBe("https://explore.tempo.xyz");
    });
  });
});

