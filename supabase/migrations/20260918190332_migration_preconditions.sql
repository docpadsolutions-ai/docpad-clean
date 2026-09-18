-- Wave 2.9 - the information_schema verification half of the migration discipline
-- clause in Proposal v1.0 2.1.
--
-- The other half of that clause, schema-reload notification, turns out to be already
-- handled by the platform: this project carries Supabase's `pgrst_ddl_watch` and
-- `pgrst_drop_watch` event triggers on ddl_command_end and sql_drop, which tell
-- PostgREST to reload after any DDL. Nothing to build, and worth recording so nobody
-- builds a second one. `_notify_schema_reload()` below exists only for the rare case
-- of forcing it by hand.
--
-- The verification half did not exist, and this week produced two good arguments for
-- it, both of which cost a debugging cycle that an assertion would have turned into
-- one clear error:
--
--   * invoices.balance_due is a GENERATED column. A migration tried to assign to it
--     and failed mid-way through a test, with the reason buried three CONTEXT lines
--     deep in a trigger stack.
--   * invoice_line_items.net_amount and friends DEFAULT to 0, not null, so a trigger
--     written as coalesce(NEW.x, computed) silently never fired and produced a line
--     that came to zero.
--
-- These are cheap to call and they fail at the top of a migration with a sentence
-- rather than half way down with a stack trace. Use them in any migration whose
-- correctness depends on the shape it expects to find.

create or replace function public._assert_column(
  p_table    text,
  p_column   text,
  p_expected boolean default true
)
returns void
language plpgsql
stable
as $function$
declare v_found boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = p_table and column_name = p_column
  ) into v_found;

  if v_found <> p_expected then
    raise exception
      'Migration precondition failed: public.%.% %',
      p_table, p_column,
      case when p_expected then 'was expected to exist and does not'
           else 'was expected not to exist and does' end
      using errcode = '42P10';
  end if;
end;
$function$;

create or replace function public._assert_column_type(p_table text, p_column text, p_type text)
returns void
language plpgsql
stable
as $function$
declare v_type text;
begin
  select data_type into v_type from information_schema.columns
   where table_schema = 'public' and table_name = p_table and column_name = p_column;

  if v_type is null then
    raise exception 'Migration precondition failed: public.%.% does not exist', p_table, p_column
      using errcode = '42P10';
  end if;
  if lower(v_type) <> lower(p_type) then
    raise exception 'Migration precondition failed: public.%.% is %, expected %',
      p_table, p_column, v_type, p_type using errcode = '42P10';
  end if;
end;
$function$;

-- The balance_due lesson. A generated column cannot be assigned, so any migration
-- that means to write one should say so first and find out cheaply.
create or replace function public._assert_not_generated(p_table text, p_column text)
returns void
language plpgsql
stable
as $function$
declare v_gen text;
begin
  select is_generated into v_gen from information_schema.columns
   where table_schema = 'public' and table_name = p_table and column_name = p_column;

  if v_gen is null then
    raise exception 'Migration precondition failed: public.%.% does not exist', p_table, p_column
      using errcode = '42P10';
  end if;
  if v_gen = 'ALWAYS' then
    raise exception
      'Migration precondition failed: public.%.% is a GENERATED column and cannot be written to',
      p_table, p_column using errcode = '42P10';
  end if;
end;
$function$;

-- The zero-default lesson. A trigger that fills blanks with coalesce() is wrong the
-- moment the column has a non-null default, and it is wrong silently.
create or replace function public._assert_column_default(
  p_table   text,
  p_column  text,
  p_default text   -- null asserts that there is no default
)
returns void
language plpgsql
stable
as $function$
declare v_def text; v_exists boolean;
begin
  select true, column_default into v_exists, v_def from information_schema.columns
   where table_schema = 'public' and table_name = p_table and column_name = p_column;

  if not coalesce(v_exists, false) then
    raise exception 'Migration precondition failed: public.%.% does not exist', p_table, p_column
      using errcode = '42P10';
  end if;
  if coalesce(v_def, '<none>') <> coalesce(p_default, '<none>') then
    raise exception
      'Migration precondition failed: public.%.% defaults to %, expected %',
      p_table, p_column, coalesce(v_def, '<none>'), coalesce(p_default, '<none>')
      using errcode = '42P10';
  end if;
end;
$function$;

create or replace function public._assert_function(p_name text, p_args text default null)
returns void
language plpgsql
stable
as $function$
declare v_found boolean;
begin
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = p_name
       and (p_args is null or pg_get_function_identity_arguments(p.oid) = p_args)
  ) into v_found;

  if not v_found then
    raise exception 'Migration precondition failed: function public.%(%) does not exist',
      p_name, coalesce(p_args, '...') using errcode = '42P10';
  end if;
end;
$function$;

create or replace function public._assert_rls(p_table text)
returns void
language plpgsql
stable
as $function$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = p_table and c.relkind = 'r' and c.relrowsecurity
  ) then
    raise exception 'Migration precondition failed: public.% does not have RLS enabled', p_table
      using errcode = '42P10';
  end if;
end;
$function$;

-- Only needed when DDL happened somewhere the event triggers cannot see it.
create or replace function public._notify_schema_reload()
returns void
language plpgsql
as $function$
begin
  notify pgrst, 'reload schema';
end;
$function$;

comment on function public._assert_column(text, text, boolean) is
  'Migration precondition. Fails with one clear sentence instead of half an applied migration.';
comment on function public._notify_schema_reload() is
  'Manual PostgREST schema reload. Normally unnecessary: the pgrst_ddl_watch and pgrst_drop_watch event triggers already do this after any DDL.';

do $$
begin
  -- The helpers, proving themselves against the two cases that motivated them.
  perform public._assert_column('invoices', 'balance_due');
  perform public._assert_column('invoices', 'no_such_column', false);
  perform public._assert_column_default('invoice_line_items', 'net_amount', '0');
  perform public._assert_function('recalc_invoice_totals', 'p_invoice_id uuid');
  perform public._assert_rls('invoices');

  begin
    perform public._assert_not_generated('invoices', 'balance_due');
    raise exception 'the generated-column assertion did not fire';
  exception when sqlstate '42P10' then null;
  end;
end $$;
