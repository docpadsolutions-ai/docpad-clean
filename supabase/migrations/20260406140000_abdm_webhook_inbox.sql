CREATE TABLE public.abdm_webhook_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.abdm_webhook_inbox ENABLE ROW LEVEL SECURITY;

-- service_role: explicit allow-all policy (PostgREST service key bypasses RLS, but policy documents intent).
CREATE POLICY service_role_only ON public.abdm_webhook_inbox
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
