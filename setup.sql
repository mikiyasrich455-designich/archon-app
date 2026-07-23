-- ARCHON WALLET v2: Wallets table keyed by seed phrase hash
-- No email auth needed. Wallet data encrypted with user's seed phrase.
-- Run in: https://supabase.com/dashboard/project/vjljoydtwvpvhqiecbqr/sql/new

DROP TABLE IF EXISTS recovery_keys CASCADE;
DROP TABLE IF EXISTS user_wallets CASCADE;
DROP TABLE IF EXISTS otp_codes CASCADE;

CREATE TABLE IF NOT EXISTS wallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seed_hash TEXT NOT NULL UNIQUE,
  recovery_key_hash TEXT,
  wallet_address TEXT NOT NULL,
  encrypted_seed TEXT NOT NULL,
  encrypted_pk TEXT NOT NULL,
  encrypted_seed_rk TEXT,
  encrypted_pk_rk TEXT,
  profile JSONB DEFAULT '{}',
  tx_history JSONB DEFAULT '[]',
  gift_codes JSONB DEFAULT '{}',
  points INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallets_recovery_key ON wallets(recovery_key_hash);

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read wallets" ON wallets;
DROP POLICY IF EXISTS "Anyone can insert wallets" ON wallets;
DROP POLICY IF EXISTS "Anyone can update wallets" ON wallets;

CREATE POLICY "Anyone can read wallets" ON wallets FOR SELECT USING (true);
CREATE POLICY "Anyone can insert wallets" ON wallets FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update wallets" ON wallets FOR UPDATE USING (true);
