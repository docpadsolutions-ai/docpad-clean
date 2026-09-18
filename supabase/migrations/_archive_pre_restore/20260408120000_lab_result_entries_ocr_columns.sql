-- Track how lab rows were entered and link back to OCR upload when applicable.
ALTER TABLE public.lab_result_entries
  ADD COLUMN IF NOT EXISTS entry_method text,
  ADD COLUMN IF NOT EXISTS entered_by uuid REFERENCES auth.users (id),
  ADD COLUMN IF NOT EXISTS ocr_upload_id uuid REFERENCES public.investigation_ocr_uploads (id);

CREATE INDEX IF NOT EXISTS lab_result_entries_ocr_upload_id_idx ON public.lab_result_entries (ocr_upload_id);
CREATE INDEX IF NOT EXISTS lab_result_entries_entered_by_idx ON public.lab_result_entries (entered_by);
