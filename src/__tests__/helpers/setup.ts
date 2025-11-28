import { beforeAll, beforeEach, afterAll, vi } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "dotenv";
import path from "path";

// Load test environment variables
config({ path: path.resolve(process.cwd(), ".env.test") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

// Test Supabase client
let testSupabase: SupabaseClient | null = null;

export function getTestSupabase(): SupabaseClient {
  if (!testSupabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;

    if (!url || !key) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SECRET_KEY must be set for integration tests"
      );
    }

    testSupabase = createClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return testSupabase;
}

// Generate a random test wallet address
export function generateTestWallet(): {
  address: `0x${string}`;
  privateKey: `0x${string}`;
} {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    privateKey,
  };
}

// Clean up test data from database
export async function cleanupTestData(supabase: SupabaseClient): Promise<void> {
  // Delete test records in reverse order of dependencies
  await supabase.from("offramps").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("onramps").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("users").delete().neq("id", "00000000-0000-0000-0000-000000000000");
}

// Create a test user fixture
export async function createTestUser(
  supabase: SupabaseClient,
  overrides: {
    wallet_address?: string;
    stripe_customer_id?: string | null;
    stripe_bank_account_id?: string | null;
  } = {}
) {
  const wallet = generateTestWallet();

  const { data, error } = await supabase
    .from("users")
    .insert({
      wallet_address: overrides.wallet_address ?? wallet.address.toLowerCase(),
      stripe_customer_id: overrides.stripe_customer_id ?? null,
      stripe_bank_account_id: overrides.stripe_bank_account_id ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return { user: data, wallet };
}

// Create a test onramp fixture
export async function createTestOnramp(
  supabase: SupabaseClient,
  overrides: {
    payment_intent_id?: string;
    user_address?: string;
    amount_usd?: number;
    status?: "pending" | "paid" | "minting" | "minted" | "failed";
    mint_tx_hash?: string | null;
    error_message?: string | null;
  } = {}
) {
  const wallet = generateTestWallet();

  const { data, error } = await supabase
    .from("onramps")
    .insert({
      payment_intent_id: overrides.payment_intent_id ?? `pi_test_${Date.now()}`,
      user_address: overrides.user_address ?? wallet.address.toLowerCase(),
      amount_usd: overrides.amount_usd ?? 10000, // $100 in cents
      status: overrides.status ?? "pending",
      mint_tx_hash: overrides.mint_tx_hash ?? null,
      error_message: overrides.error_message ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return { onramp: data, wallet };
}

// Create a test offramp fixture
export async function createTestOfframp(
  supabase: SupabaseClient,
  overrides: {
    memo?: string;
    user_address?: string;
    amount_usd?: number;
    status?: "pending" | "transferred" | "burning" | "burned" | "paying" | "paid_out" | "failed";
    transfer_tx_hash?: string | null;
    burn_tx_hash?: string | null;
    stripe_payout_id?: string | null;
    error_message?: string | null;
  } = {}
) {
  const wallet = generateTestWallet();
  const memo =
    overrides.memo ??
    `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;

  const { data, error } = await supabase
    .from("offramps")
    .insert({
      memo,
      user_address: overrides.user_address ?? wallet.address.toLowerCase(),
      amount_usd: overrides.amount_usd ?? 5000, // $50 in cents
      status: overrides.status ?? "pending",
      transfer_tx_hash: overrides.transfer_tx_hash ?? null,
      burn_tx_hash: overrides.burn_tx_hash ?? null,
      stripe_payout_id: overrides.stripe_payout_id ?? null,
      error_message: overrides.error_message ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return { offramp: data, wallet, memo };
}

// Test context type
export interface TestContext {
  supabase: SupabaseClient;
}

// Global test setup
beforeAll(async () => {
  // Verify required environment variables
  const required = ["SUPABASE_URL", "SUPABASE_SECRET_KEY"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.warn(
      `Warning: Missing environment variables for integration tests: ${missing.join(", ")}`
    );
  }
});

// Clean up before each test
beforeEach(async () => {
  // Reset any mocks
  vi.clearAllMocks();
});

// Global teardown
afterAll(async () => {
  // Clean up test data
  if (testSupabase) {
    try {
      await cleanupTestData(testSupabase);
    } catch (error) {
      console.warn("Failed to cleanup test data:", error);
    }
  }
});

// Export commonly used test utilities
export { vi };

