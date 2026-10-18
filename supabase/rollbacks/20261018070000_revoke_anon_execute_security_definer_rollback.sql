-- Restores the grants removed by 20261018070000_revoke_anon_execute_security_definer.sql
-- (EXECUTE to PUBLIC on all 15, and to authenticated on the trigger functions), which
-- makes them anon-executable again and re-fails rls_isolation.sql test 2.

grant execute on function public.clear_encounter_draft(uuid) to public;
grant execute on function public.get_encounter_draft(uuid) to public;
grant execute on function public.save_encounter_draft(uuid, jsonb) to public;
grant execute on function public.invite_first_admin(uuid, text) to public;
grant execute on function public.is_platform_admin() to public;
grant execute on function public.list_hospitals_for_platform_admin() to public;
grant execute on function public.provision_hospital(text, text, text, text, text, text, text, text, text, text, text, jsonb) to public;
grant execute on function public.set_hospital_live(uuid) to public;

grant execute on function public.fn_fhir_opd_encounter() to public, authenticated;
grant execute on function public.trg_assign_cr_number() to public, authenticated;
grant execute on function public.trg_block_unsafe_prescription() to public, authenticated;
grant execute on function public.trg_lock_finalized_encounter() to public, authenticated;
grant execute on function public.trg_recalc_invoice_from_child() to public, authenticated;
grant execute on function public.trg_set_encounter_visit_type() to public, authenticated;
grant execute on function public.trg_set_mobile_hash() to public, authenticated;
