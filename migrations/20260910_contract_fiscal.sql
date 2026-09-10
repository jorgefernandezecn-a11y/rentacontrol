-- Additive: rent remains the legacy expected amount; no balances or payments change.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS rent_fiscal jsonb;
