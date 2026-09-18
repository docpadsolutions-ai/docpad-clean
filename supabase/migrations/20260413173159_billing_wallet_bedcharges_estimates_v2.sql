-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413173159.

-- ============================================================
-- 1. PATIENT WALLET
-- ============================================================
CREATE TABLE IF NOT EXISTS public.patient_wallet (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id          uuid NOT NULL REFERENCES public.patients(id),
  balance             numeric NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency            text NOT NULL DEFAULT 'INR',
  last_transaction_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, patient_id)
);

ALTER TABLE public.patient_wallet ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_scope" ON public.patient_wallet
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES public.hospitals(id),
  wallet_id        uuid NOT NULL REFERENCES public.patient_wallet(id),
  patient_id       uuid NOT NULL REFERENCES public.patients(id),
  type             text NOT NULL CHECK (type IN ('credit','debit','refund','adjustment')),
  amount           numeric NOT NULL CHECK (amount > 0),
  balance_after    numeric NOT NULL,
  reference_type   text CHECK (reference_type IN ('advance_payment','invoice_settlement','refund','manual')),
  reference_id     uuid,
  invoice_id       uuid REFERENCES public.invoices(id),
  payment_method   text CHECK (payment_method IN ('cash','upi','card','netbanking','cheque','insurance','other')),
  reference_number text,
  performed_by     uuid REFERENCES public.practitioners(id),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_scope" ON public.wallet_transactions
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));

-- ============================================================
-- 2. WARD RATE MASTER
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ward_rate_master (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id),
  ward_id         uuid REFERENCES public.ipd_wards(id),
  ward_type       text NOT NULL CHECK (ward_type IN ('general','private','semi_private','icu','hdu','nicu','picu','isolation','daycare')),
  rate_per_day    numeric NOT NULL DEFAULT 0,
  nursing_charge_per_day numeric DEFAULT 0,
  diet_charge_per_day    numeric DEFAULT 0,
  effective_from  date NOT NULL DEFAULT CURRENT_DATE,
  effective_to    date,
  is_active       boolean DEFAULT true,
  currency        text DEFAULT 'INR',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ward_rate_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_scope" ON public.ward_rate_master
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));

-- ============================================================
-- 3. IPD DAILY CHARGES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ipd_daily_charges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id),
  admission_id    uuid NOT NULL REFERENCES public.ipd_admissions(id),
  patient_id      uuid NOT NULL REFERENCES public.patients(id),
  charge_date     date NOT NULL DEFAULT CURRENT_DATE,
  ward_id         uuid REFERENCES public.ipd_wards(id),
  bed_id          uuid REFERENCES public.ipd_beds(id),
  ward_type       text,
  bed_charge      numeric NOT NULL DEFAULT 0,
  nursing_charge  numeric NOT NULL DEFAULT 0,
  diet_charge     numeric NOT NULL DEFAULT 0,
  other_charges   numeric DEFAULT 0,
  total_charge    numeric GENERATED ALWAYS AS (bed_charge + nursing_charge + diet_charge + COALESCE(other_charges,0)) STORED,
  charge_item_id  uuid REFERENCES public.charge_items(id),
  billed_to_invoice_id uuid REFERENCES public.invoices(id),
  billing_status  text NOT NULL DEFAULT 'unbilled' CHECK (billing_status IN ('unbilled','billed','waived')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admission_id, charge_date)
);

ALTER TABLE public.ipd_daily_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_scope" ON public.ipd_daily_charges
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));

-- ============================================================
-- 4. PROCEDURE ESTIMATES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.procedure_estimates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id          uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id           uuid NOT NULL REFERENCES public.patients(id),
  admission_id         uuid REFERENCES public.ipd_admissions(id),
  surgery_id           uuid REFERENCES public.ot_surgeries(id),
  opd_encounter_id     uuid REFERENCES public.opd_encounters(id),
  estimate_number      text UNIQUE,
  estimate_date        date NOT NULL DEFAULT CURRENT_DATE,
  valid_until          date,
  line_items           jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_total      numeric NOT NULL DEFAULT 0,
  deposit_requested    numeric DEFAULT 0,
  deposit_collected    numeric DEFAULT 0,
  status               text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','presented','accepted','declined','superseded','final_billed')),
  presented_at         timestamptz,
  accepted_at          timestamptz,
  accepted_by_name     text,
  accepted_by_relation text,
  patient_signature_url text,
  actual_invoice_id    uuid REFERENCES public.invoices(id),
  variance_amount      numeric,
  variance_reason      text,
  created_by           uuid REFERENCES public.practitioners(id),
  notes                text,
  fhir_json            jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.procedure_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_scope" ON public.procedure_estimates
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));

-- Auto-number estimates
CREATE OR REPLACE FUNCTION public.set_estimate_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE seq_val int;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(estimate_number FROM 'EST-([0-9]+)') AS int)), 0) + 1
  INTO seq_val
  FROM public.procedure_estimates
  WHERE hospital_id = NEW.hospital_id;
  NEW.estimate_number := 'EST-' || LPAD(seq_val::text, 6, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_estimate_number
  BEFORE INSERT ON public.procedure_estimates
  FOR EACH ROW WHEN (NEW.estimate_number IS NULL)
  EXECUTE FUNCTION public.set_estimate_number();

-- updated_at triggers
CREATE TRIGGER trg_wallet_updated_at
  BEFORE UPDATE ON public.patient_wallet
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_ward_rate_updated_at
  BEFORE UPDATE ON public.ward_rate_master
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_daily_charges_updated_at
  BEFORE UPDATE ON public.ipd_daily_charges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_estimates_updated_at
  BEFORE UPDATE ON public.procedure_estimates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
