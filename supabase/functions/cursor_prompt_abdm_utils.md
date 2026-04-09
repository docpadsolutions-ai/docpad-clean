# ABDM Edge Functions — flow & structure

Use with Supabase Edge Functions under `supabase/functions/`. Shared code: `_shared/abdm-utils.ts`.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `ABDM_GATEWAY_URL` | Gateway base URL (no trailing slash) |
| `ABDM_CLIENT_ID` | Gateway `clientId` |
| `ABDM_CLIENT_SECRET` | Gateway `clientSecret` |
| `ABDM_CM_ID` | `X-CM-ID` header (sandbox often `sbx`) |
| `ABDM_HIP_ID` | Default `X-HIP-ID` (HIP flows) |
| `ABDM_HIU_ID` | Default `X-HIU-ID` (HIU flows) |
| `ABDM_SESSIONS_PATH` | Override session POST path (default `/gateway/v3/sessions`) |
| `ABDM_LINK_INIT_PATH` | Link start path (default `/hip/v3/patients/link/on-init`) |
| `ABDM_LINK_CONFIRM_PATH` | OTP confirm path (default `/hip/v3/patients/link/on-confirm`) |
| `ABDM_CONSENT_APPROVE_PATH` | Consent / doctor step path (**must match your NDHM contract**) |
| `ABDM_HI_DATA_PUSH_PATH` | Encrypted HI push path (default `/hip/v3/health-information/request/on-request`) |
| `ABDM_WEBHOOK_SECRET` | Optional; if set, webhook must send `X-ABDM-Webhook-Secret` or `Authorization: Bearer <secret>` |
| `SUPABASE_URL` | For JWT validation & service inserts |
| `SUPABASE_ANON_KEY` | For `auth.getUser()` |
| `SUPABASE_SERVICE_ROLE_KEY` | For `consent-request-notify` DB persistence |

---

## 1. `abdm-auth` — Token management

- **Method:** `POST`
- **Auth:** End-user Supabase JWT (`Authorization: Bearer`)
- **Body:** `{ "forceRefresh": boolean }` (optional)
- **Flow:** `requireUserJwt` → `getGatewayAccessToken(forceRefresh)` → gateway `sessions` with `client_credentials` → returns `{ accessToken, tokenType, expiresIn, expiresAtIso }` (cached in isolate until ~1 min before expiry).

---

## 2. `abha-link-init` — Start patient linking

- **Method:** `POST`
- **Auth:** Supabase JWT
- **Body (mapped):** `{ abhaNumber, patient: { id, name, gender?, yearOfBirth? }, purpose? }`
- **Body (raw):** `{ payload: { ... } }` forwarded as-is
- **Flow:** Build HIP link/on-init JSON → `abdmPostJson(ABDM_LINK_INIT_PATH)` with standard headers + gateway bearer.

---

## 3. `abha-link-confirm` — Complete with OTP

- **Method:** `POST`
- **Auth:** Supabase JWT
- **Body (mapped):** `{ otp, txnId | transactionId }`
- **Body (raw):** `{ payload: { ... } }`
- **Flow:** `abdmPostJson(ABDM_LINK_CONFIRM_PATH)`.

---

## 4. `consent-request-notify` — Webhook handler

- **Method:** `POST`
- **Auth:** `verify_jwt = false`; optional `ABDM_WEBHOOK_SECRET`
- **Body:** CM payload (typically includes `notification`)
- **Flow:** `assertWebhookSecret` → parse JSON → insert into `public.abdm_webhook_inbox` (service role) → `{ ok, received, persisted }`

---

## 5. `consent-approve` — Doctor grants / HIU consent step

- **Method:** `POST`
- **Auth:** Supabase JWT
- **Body (mapped):** `{ consentRequestId, status?, consentArtefacts?, hiuId? }`
- **Body (raw):** `{ payload: { ... } }`
- **Flow:** `abdmPostJson(ABDM_CONSENT_APPROVE_PATH)` with optional `X-HIU-ID` override.

---

## 6. `hi-data-transfer` — Push encrypted FHIR bundle

- **Method:** `POST`
- **Auth:** Supabase JWT
- **Body:** `{ transactionId, bundle (FHIR Bundle), recipientPublicKeyPem (RSA), pushUrl?, hiuId?, extras? }`
- **Flow:** Canonical JSON → AES-256-GCM → RSA-OAEP-256 wrap key → POST envelope (`keyMaterial`, `encryptedFhirBundle`, …) to `pushUrl` or `ABDM_HI_DATA_PUSH_PATH`.
- **Passthrough:** `{ payload, pushUrl?, hiuId? }` skips encryption (for sandbox / alternate contracts).

---

## Deploy

```bash
supabase functions deploy abdm-auth
supabase functions deploy abha-link-init
supabase functions deploy abha-link-confirm
supabase functions deploy consent-request-notify
supabase functions deploy consent-approve
supabase functions deploy hi-data-transfer
```

Apply migration `20260406140000_abdm_webhook_inbox.sql` for webhook persistence.

**Note:** Default REST paths are conventions; NDHM sandbox/production paths differ — set `ABDM_*_PATH` env vars to match your bridge documentation.
