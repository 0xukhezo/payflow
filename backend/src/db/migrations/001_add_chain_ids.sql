-- Run this in the Supabase SQL editor
ALTER TABLE companies      ADD COLUMN IF NOT EXISTS chain_id           integer DEFAULT 11155111;
ALTER TABLE employees      ADD COLUMN IF NOT EXISTS preferred_chain_id integer DEFAULT 11155111;
ALTER TABLE payroll_runs   ADD COLUMN IF NOT EXISTS deposit_chain_id   integer DEFAULT 11155111;
ALTER TABLE payroll_runs   ADD COLUMN IF NOT EXISTS settle_chain_id    integer DEFAULT 11155111;
ALTER TABLE payroll_runs   ADD COLUMN IF NOT EXISTS is_cross_chain     boolean DEFAULT false;
ALTER TABLE payroll_runs   ADD COLUMN IF NOT EXISTS transfer_tx_hash   text;
ALTER TABLE payroll_runs   ADD COLUMN IF NOT EXISTS swap_tx_hash       text;
