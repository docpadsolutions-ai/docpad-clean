-- Signed-out callers (anon) could execute 15 SECURITY DEFINER functions, because each
-- carried the default EXECUTE grant to PUBLIC, which anon inherits. Most were created
-- by the four migrations from 19-20 Sep 2026 that have no file in this repo
-- (BREAKAGE-TRIAGE N-01, N-02). supabase/tests/rls_isolation.sql test 2 has failed on
-- this every day since 20 Sep.
--
-- Reviewed 18 Oct 2026 before revoking: every callable one already refuses an anon
-- caller on its own (is_platform_admin() is false without auth.uid(); the platform-admin
-- RPCs raise 42501; the encounter-draft RPCs match on auth_hospital_id(), which is null
-- for anon). So this closes a missing layer rather than an active leak. The one thing
-- anon could learn was whether an encounter id exists, from save_encounter_draft's
-- error text.
--
-- RPCs: revoke from PUBLIC and anon only. authenticated and service_role hold their own
-- explicit grants, so signed-in behaviour does not change.
-- Trigger functions: revoke from PUBLIC, anon and authenticated. PostgREST cannot call
-- them, and firing a trigger does not check EXECUTE.
--
-- Rollback: supabase/rollbacks/20261018070000_revoke_anon_execute_security_definer_rollback.sql

-- Callable RPCs
revoke execute on function public.clear_encounter_draft(uuid) from public, anon;
revoke execute on function public.get_encounter_draft(uuid) from public, anon;
revoke execute on function public.save_encounter_draft(uuid, jsonb) from public, anon;
revoke execute on function public.invite_first_admin(uuid, text) from public, anon;
revoke execute on function public.is_platform_admin() from public, anon;
revoke execute on function public.list_hospitals_for_platform_admin() from public, anon;
revoke execute on function public.provision_hospital(text, text, text, text, text, text, text, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.set_hospital_live(uuid) from public, anon;

-- Trigger functions
revoke execute on function public.fn_fhir_opd_encounter() from public, anon, authenticated;
revoke execute on function public.trg_assign_cr_number() from public, anon, authenticated;
revoke execute on function public.trg_block_unsafe_prescription() from public, anon, authenticated;
revoke execute on function public.trg_lock_finalized_encounter() from public, anon, authenticated;
revoke execute on function public.trg_recalc_invoice_from_child() from public, anon, authenticated;
revoke execute on function public.trg_set_encounter_visit_type() from public, anon, authenticated;
revoke execute on function public.trg_set_mobile_hash() from public, anon, authenticated;
