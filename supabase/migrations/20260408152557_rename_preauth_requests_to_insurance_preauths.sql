-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408152557.

-- Rename preauth_requests table to insurance_preauths, then create view
ALTER TABLE preauth_requests RENAME TO insurance_preauths;

-- Create passthrough view
CREATE VIEW preauth_requests
WITH (security_invoker = true) AS
SELECT * FROM insurance_preauths;

COMMENT ON VIEW preauth_requests IS 
'Passthrough to insurance_preauths so PostgREST nested selects resolve (single source table).';

GRANT SELECT ON preauth_requests TO authenticated;
