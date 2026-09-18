-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408060028.

-- Add currency column to charge_items (FHIR ChargeItem.priceOverride.currency)
ALTER TABLE charge_items 
ADD COLUMN currency TEXT DEFAULT 'INR';

-- Add index if needed for filtering
CREATE INDEX idx_charge_items_currency ON charge_items(currency);
