import { createClient } from "@supabase/supabase-js";
import { config, publicConfig } from "./config";

// Database types
export interface OnrampRecord {
  id: string;
  payment_intent_id: string;
  user_address: string;
  amount_usd: number; // Amount in cents
  status: "pending" | "paid" | "minting" | "minted" | "failed";
  mint_tx_hash: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface OfframpRecord {
  id: string;
  memo: string;
  user_address: string;
  amount_usd: number; // Amount in cents
  status: "pending" | "transferred" | "burning" | "burned" | "paying" | "paid_out" | "failed";
  transfer_tx_hash: string | null;
  burn_tx_hash: string | null;
  stripe_payout_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRecord {
  id: string;
  wallet_address: string;
  stripe_customer_id: string | null;
  stripe_bank_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      onramps: {
        Row: OnrampRecord;
        Insert: Omit<OnrampRecord, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<OnrampRecord, "id" | "created_at">>;
      };
      offramps: {
        Row: OfframpRecord;
        Insert: Omit<OfframpRecord, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<OfframpRecord, "id" | "created_at">>;
      };
      users: {
        Row: UserRecord;
        Insert: Omit<UserRecord, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<UserRecord, "id" | "created_at">>;
      };
    };
  };
}

// Server-side Supabase client (uses secret API key)
export function createSupabaseClient() {
  if (!config.supabaseUrl) {
    throw new Error("SUPABASE_URL is not configured");
  }
  
  if (!config.supabaseSecretKey) {
    throw new Error("SUPABASE_SECRET_KEY is not configured (should start with sb_secret_...)");
  }
  
  // Note: Using 'any' to avoid complex type inference issues with Supabase client
  // The actual types are enforced at the function return level
  return createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: {
      persistSession: false,
    },
    global: {
      fetch: (url, options) => {
        return fetch(url, {
          ...options,
          cache: "no-store",
        });
      },
    },
  });
}

// Client-side Supabase client (uses public key)
export function createSupabaseBrowserClient() {
  if (!publicConfig.supabaseUrl) {
    console.warn("NEXT_PUBLIC_SUPABASE_URL is not configured");
  }
  
  if (!publicConfig.supabaseKey) {
    console.warn("NEXT_PUBLIC_SUPABASE_KEY is not configured");
  }

  return createClient(
    publicConfig.supabaseUrl,
    publicConfig.supabaseKey
  );
}

type SupabaseClient = ReturnType<typeof createSupabaseClient>;


// Helper functions for database operations
export async function createOnrampRecord(
  supabase: SupabaseClient,
  data: {
    payment_intent_id: string;
    user_address: string;
    amount_usd: number;
  }
): Promise<OnrampRecord> {
  const { data: record, error } = await supabase
    .from("onramps")
    .insert({
      payment_intent_id: data.payment_intent_id,
      user_address: data.user_address,
      amount_usd: data.amount_usd,
      status: "pending",
      mint_tx_hash: null,
      error_message: null,
    })
    .select()
    .single();

  if (error) throw error;
  return record as OnrampRecord;
}

export async function getOnrampByPaymentIntent(
  supabase: SupabaseClient,
  paymentIntentId: string
): Promise<OnrampRecord | null> {
  const { data, error } = await supabase
    .from("onramps")
    .select()
    .eq("payment_intent_id", paymentIntentId)
    .single();

  if (error && error.code !== "PGRST116") throw error; // PGRST116 = not found
  return data;
}

export async function updateOnrampStatus(
  supabase: SupabaseClient,
  paymentIntentId: string,
  update: {
    status: OnrampRecord["status"];
    mint_tx_hash?: string;
    error_message?: string;
  }
): Promise<OnrampRecord> {
  const { data, error } = await supabase
    .from("onramps")
    .update(update)
    .eq("payment_intent_id", paymentIntentId)
    .select()
    .single();

  if (error) throw error;
  return data as OnrampRecord;
}

export async function createOfframpRecord(
  supabase: SupabaseClient,
  data: {
    memo: string;
    user_address: string;
    amount_usd: number;
  }
): Promise<OfframpRecord> {
  const { data: record, error } = await supabase
    .from("offramps")
    .insert({
      memo: data.memo,
      user_address: data.user_address,
      amount_usd: data.amount_usd,
      status: "pending",
      transfer_tx_hash: null,
      burn_tx_hash: null,
      stripe_payout_id: null,
      error_message: null,
    })
    .select()
    .single();

  if (error) throw error;
  return record as OfframpRecord;
}

export async function getOfframpById(
  supabase: SupabaseClient,
  id: string
): Promise<OfframpRecord | null> {
  const { data, error } = await supabase
    .from("offramps")
    .select()
    .eq("id", id)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function getOfframpByMemo(
  supabase: SupabaseClient,
  memo: string
): Promise<OfframpRecord | null> {
  const { data, error } = await supabase
    .from("offramps")
    .select()
    .eq("memo", memo)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function getPendingOfframps(
  supabase: SupabaseClient
): Promise<OfframpRecord[]> {
  const { data, error } = await supabase
    .from("offramps")
    .select()
    .eq("status", "pending");

  if (error) throw error;
  return (data || []) as OfframpRecord[];
}

export async function updateOfframpStatus(
  supabase: SupabaseClient,
  id: string,
  update: {
    status: OfframpRecord["status"];
    transfer_tx_hash?: string;
    burn_tx_hash?: string;
    stripe_payout_id?: string;
    error_message?: string;
  }
): Promise<OfframpRecord> {
  const { data, error } = await supabase
    .from("offramps")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as OfframpRecord;
}

// User functions for Stripe Customer management

export async function getUserByAddress(
  supabase: SupabaseClient,
  walletAddress: string
): Promise<UserRecord | null> {
  const { data, error } = await supabase
    .from("users")
    .select()
    .eq("wallet_address", walletAddress.toLowerCase())
    .single();

  if (error && error.code !== "PGRST116") throw error; // PGRST116 = not found
  return data;
}

export async function createUser(
  supabase: SupabaseClient,
  data: {
    wallet_address: string;
    stripe_customer_id?: string;
    stripe_bank_account_id?: string;
  }
): Promise<UserRecord> {
  const { data: record, error } = await supabase
    .from("users")
    .insert({
      wallet_address: data.wallet_address.toLowerCase(),
      stripe_customer_id: data.stripe_customer_id || null,
      stripe_bank_account_id: data.stripe_bank_account_id || null,
    })
    .select()
    .single();

  if (error) throw error;
  return record as UserRecord;
}

export async function updateUserStripeCustomer(
  supabase: SupabaseClient,
  walletAddress: string,
  stripeCustomerId: string
): Promise<UserRecord> {
  const { data, error } = await supabase
    .from("users")
    .update({ stripe_customer_id: stripeCustomerId })
    .eq("wallet_address", walletAddress.toLowerCase())
    .select()
    .single();

  if (error) throw error;
  return data as UserRecord;
}

export async function getOrCreateUser(
  supabase: SupabaseClient,
  walletAddress: string
): Promise<UserRecord> {
  // Try to find existing user
  const existing = await getUserByAddress(supabase, walletAddress);
  if (existing) return existing;

  // Create new user
  return createUser(supabase, { wallet_address: walletAddress });
}

export async function updateUserBankAccount(
  supabase: SupabaseClient,
  walletAddress: string,
  stripeBankAccountId: string
): Promise<UserRecord> {
  const { data, error } = await supabase
    .from("users")
    .update({ stripe_bank_account_id: stripeBankAccountId })
    .eq("wallet_address", walletAddress.toLowerCase())
    .select()
    .single();

  if (error) throw error;
  return data as UserRecord;
}

