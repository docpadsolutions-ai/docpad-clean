-- Signed-out visitors never read or write tables directly (public pages use narrow RPCs),
-- so anon loses all table/view/sequence privileges in public. RLS stays as the second layer.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Signed-in users never need TRUNCATE (bypasses RLS), TRIGGER or REFERENCES.
revoke truncate, trigger, references on all tables in schema public from authenticated;

-- Same defaults for objects created by future migrations.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke truncate, trigger, references on tables from authenticated;
