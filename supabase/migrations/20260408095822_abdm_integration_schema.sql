-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408095822.

-- =====================================================
-- ABDM (Ayushman Bharat Digital Mission) Integration
-- Following NDHM M2 API Specifications
-- =====================================================

-- 1. ABHA Session Management (for patient linking workflows)
CREATE TABLE IF NOT EXISTS abha_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    session_token TEXT NOT NULL,
    session_type TEXT NOT NULL CHECK (session_type IN (
        'init_abha_number', 
        'init_abha_address', 
        'verify_aadhaar',
        'verify_mobile',
        'auth_init'
    )),
    auth_mode TEXT CHECK (auth_mode IN ('AADHAAR_OTP', 'MOBILE_OTP', 'DEMOGRAPHICS')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'verified', 'expired', 'cancelled')),
    expires_at TIMESTAMPTZ NOT NULL,
    request_payload JSONB,
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Health Information Provider (HIP) Linking
CREATE TABLE IF NOT EXISTS hip_link_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id TEXT UNIQUE NOT NULL,
    patient_id UUID NOT NULL REFERENCES patients(id),
    abha_address TEXT NOT NULL,
    auth_mode TEXT NOT NULL CHECK (auth_mode IN ('MOBILE_OTP', 'DIRECT')),
    link_reference_number TEXT UNIQUE,
    care_contexts JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN (
        'requested', 
        'otp_sent', 
        'linked', 
        'expired', 
        'denied'
    )),
    otp_sent_at TIMESTAMPTZ,
    linked_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Consent Requests (M2 Consent Flow)
CREATE TABLE IF NOT EXISTS abdm_consent_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id TEXT UNIQUE NOT NULL,
    patient_id UUID NOT NULL REFERENCES patients(id),
    patient_abha_address TEXT NOT NULL,
    requester_name TEXT NOT NULL,
    requester_id TEXT NOT NULL,
    purpose_text TEXT NOT NULL,
    purpose_code TEXT NOT NULL,
    hi_types TEXT[] NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    data_erase_at TIMESTAMPTZ,
    permission JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
        'REQUESTED',
        'GRANTED',
        'DENIED',
        'EXPIRED',
        'REVOKED'
    )),
    granted_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    consent_artifact_id TEXT,
    signature TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Health Information Data Transfers (M2)
CREATE TABLE IF NOT EXISTS hi_data_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id TEXT UNIQUE NOT NULL,
    consent_id TEXT NOT NULL,
    patient_id UUID NOT NULL REFERENCES patients(id),
    requester_id TEXT NOT NULL,
    data_push_url TEXT NOT NULL,
    key_material JSONB NOT NULL,
    nonce TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN (
        'requested',
        'processing',
        'transferred',
        'error'
    )),
    encounter_refs JSONB DEFAULT '[]'::jsonb,
    fhir_bundle JSONB,
    encrypted_data TEXT,
    transferred_at TIMESTAMPTZ,
    error_code TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. ABDM Subscription (for on-notify, on-link-confirm callbacks)
CREATE TABLE IF NOT EXISTS abdm_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES hospitals(id),
    subscription_id TEXT UNIQUE NOT NULL,
    event_category TEXT NOT NULL CHECK (event_category IN (
        'LINK',
        'DATA_TRANSFER',
        'CONSENT_REQUEST'
    )),
    callback_url TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. ABDM Auth Tokens (for GW API calls)
CREATE TABLE IF NOT EXISTS abdm_auth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES hospitals(id),
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_type TEXT NOT NULL DEFAULT 'Bearer',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(hospital_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_abha_sessions_patient ON abha_sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_abha_sessions_token ON abha_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_hip_links_patient ON hip_link_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_hip_links_abha ON hip_link_requests(abha_address);
CREATE INDEX IF NOT EXISTS idx_consent_patient ON abdm_consent_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_consent_status ON abdm_consent_requests(status);
CREATE INDEX IF NOT EXISTS idx_hi_transfers_consent ON hi_data_transfers(consent_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_hospital ON abdm_auth_tokens(hospital_id);

-- RLS Policies (hospital-scoped)
ALTER TABLE abha_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hip_link_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE abdm_consent_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hi_data_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE abdm_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE abdm_auth_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY hospital_abha_sessions ON abha_sessions
    USING (patient_id IN (
        SELECT id FROM patients WHERE hospital_id = (auth.jwt() ->> 'hospital_id')::uuid
    ));

CREATE POLICY hospital_hip_links ON hip_link_requests
    USING (patient_id IN (
        SELECT id FROM patients WHERE hospital_id = (auth.jwt() ->> 'hospital_id')::uuid
    ));

CREATE POLICY hospital_consents ON abdm_consent_requests
    USING (patient_id IN (
        SELECT id FROM patients WHERE hospital_id = (auth.jwt() ->> 'hospital_id')::uuid
    ));

CREATE POLICY hospital_hi_transfers ON hi_data_transfers
    USING (patient_id IN (
        SELECT id FROM patients WHERE hospital_id = (auth.jwt() ->> 'hospital_id')::uuid
    ));

CREATE POLICY hospital_subscriptions ON abdm_subscriptions
    USING (hospital_id = (auth.jwt() ->> 'hospital_id')::uuid);

CREATE POLICY hospital_auth_tokens ON abdm_auth_tokens
    USING (hospital_id = (auth.jwt() ->> 'hospital_id')::uuid);

COMMENT ON TABLE abha_sessions IS 'Tracks ABHA creation/linking sessions with OTP flow state';
COMMENT ON TABLE hip_link_requests IS 'M2 link/init and link/confirm flow tracking';
COMMENT ON TABLE abdm_consent_requests IS 'Consent Manager consent request lifecycle';
COMMENT ON TABLE hi_data_transfers IS 'Health Information data push records with encryption metadata';
COMMENT ON TABLE abdm_subscriptions IS 'ABDM Gateway subscriptions for async callbacks';
COMMENT ON TABLE abdm_auth_tokens IS 'ABDM Gateway bearer tokens per hospital';
