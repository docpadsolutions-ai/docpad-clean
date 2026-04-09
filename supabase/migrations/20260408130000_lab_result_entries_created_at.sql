-- Deduplication and ordering use created_at (latest row per parameter wins).
ALTER TABLE public.lab_result_entries
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

UPDATE public.lab_result_entries
SET created_at = now()
WHERE created_at IS NULL;
