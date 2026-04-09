-- Allow clinical app (authenticated) to read consent webhook rows for UI + Realtime.
-- Inserts remain via Edge Function service role only.

create policy "abdm_webhook_inbox_select_authenticated"
on public.abdm_webhook_inbox
for select
to authenticated
using (true);

-- Broadcast INSERTs to browser clients (ignore if table is already in publication).
do $pub$
begin
  alter publication supabase_realtime add table public.abdm_webhook_inbox;
exception
  when duplicate_object then
    null;
  when others then
    if sqlerrm ilike '%already member%' or sqlerrm ilike '%already in publication%' then
      null;
    else
      raise;
    end if;
end
$pub$;
