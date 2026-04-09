-- Allow clinical users to mark consent rows processed (Deny) and similar updates.

create policy "abdm_webhook_inbox_update_authenticated"
on public.abdm_webhook_inbox
for update
to authenticated
using (true)
with check (true);
