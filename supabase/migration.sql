-- AcmeUSD Database Migration
-- Run this in Supabase SQL Editor

-- Track onramp payments (prevents double-mint)
CREATE TABLE IF NOT EXISTS onramps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id TEXT UNIQUE NOT NULL,
  user_address TEXT NOT NULL,
  amount_usd INTEGER NOT NULL,            -- Amount in cents
  status TEXT DEFAULT 'pending',          -- pending, paid, minting, minted, failed
  mint_tx_hash TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track offramp requests (matches memo to payout)
CREATE TABLE IF NOT EXISTS offramps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memo TEXT UNIQUE NOT NULL,              -- 32-byte memo hash (0x...)
  user_address TEXT NOT NULL,
  amount_usd INTEGER NOT NULL,            -- Amount in cents
  status TEXT DEFAULT 'pending',          -- pending, transferred, burning, burned, paying, paid_out, failed
  transfer_tx_hash TEXT,
  burn_tx_hash TEXT,
  stripe_payout_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_onramps_user ON onramps(user_address);
CREATE INDEX IF NOT EXISTS idx_onramps_status ON onramps(status);
CREATE INDEX IF NOT EXISTS idx_offramps_user ON offramps(user_address);
CREATE INDEX IF NOT EXISTS idx_offramps_memo ON offramps(memo);
CREATE INDEX IF NOT EXISTS idx_offramps_status ON offramps(status);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for auto-updating updated_at
DROP TRIGGER IF EXISTS onramps_updated_at ON onramps;
CREATE TRIGGER onramps_updated_at
  BEFORE UPDATE ON onramps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS offramps_updated_at ON offramps;
CREATE TRIGGER offramps_updated_at
  BEFORE UPDATE ON offramps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Track users and their Stripe Customer IDs for payouts
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  stripe_bank_account_id TEXT,           -- Linked bank account for withdrawals
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add bank account column if table already exists
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_bank_account_id TEXT;

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);

-- Trigger for users updated_at
DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable Row Level Security (optional for server-side only access)
-- ALTER TABLE onramps ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE offramps ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;

