-- Optional structured fields; existing policy data and beneficiaries are unchanged.
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS details jsonb;
