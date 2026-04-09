/** NDHM / ABDM consent-notification payloads vary; normalize patient id for inbox filtering. */

/** Primary type for new webhooks; `CONSENT_REQUEST` kept for legacy rows. */
export const ABDM_CONSENT_EVENT_TYPES = ["CONSENT_REQUEST_NOTIFY", "CONSENT_REQUEST"] as const;

export type AbdmConsentEventType = (typeof ABDM_CONSENT_EVENT_TYPES)[number];

/** @deprecated Prefer `ABDM_CONSENT_EVENT_TYPES` / `.in("event_type", …)`. */
export const ABDM_CONSENT_EVENT_TYPE = "CONSENT_REQUEST_NOTIFY";

export function isAbdmConsentEventType(eventType: string | null | undefined): boolean {
  if (!eventType) return false;
  return (ABDM_CONSENT_EVENT_TYPES as readonly string[]).includes(eventType);
}

export function inboxRowMatchesPatient(payload: unknown, patientId: string): boolean {
  const pid = patientId.trim();
  if (!pid) return false;
  const p = payload as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return false;

  const direct = [p.patient_id, p.patientId, p.patient_uuid, p.abhaAddress, p.abha_number];
  for (const d of direct) {
    if (d != null && String(d).trim() === pid) return true;
  }

  const patient = p.patient;
  if (patient && typeof patient === "object") {
    const id = (patient as Record<string, unknown>).id;
    if (id != null && String(id).trim() === pid) return true;
  }

  const notif = (p.notification ?? p.Notification) as Record<string, unknown> | undefined;
  if (notif) {
    const cr = (notif.consentRequest ?? notif.consent_request) as Record<string, unknown> | undefined;
    const patientRef = cr?.patient as Record<string, unknown> | undefined;
    const ref = patientRef?.reference != null ? String(patientRef.reference) : "";
    if (ref.includes(pid)) return true;
    const id = cr?.patientId ?? cr?.patient_id;
    if (id != null && String(id).trim() === pid) return true;
  }

  return false;
}

export function extractConsentRequestId(payload: unknown): string | null {
  const p = payload as Record<string, unknown> | null;
  if (!p) return null;
  const notif = (p.notification ?? p.Notification) as Record<string, unknown> | undefined;
  const cr = (notif?.consentRequest ?? notif?.consent_request) as Record<string, unknown> | undefined;
  if (cr?.id != null) return String(cr.id);
  if (p.consentRequestId != null) return String(p.consentRequestId);
  return null;
}

export function extractHiTypes(payload: unknown): string[] {
  const p = payload as Record<string, unknown> | null;
  if (!p) return [];
  const notif = p.notification as Record<string, unknown> | undefined;
  const cr = (notif?.consentRequest ?? notif?.consent_request) as Record<string, unknown> | undefined;
  const raw =
    p.hiTypes ??
    p.hi_types ??
    (p.consentDetail as Record<string, unknown> | undefined)?.hiTypes ??
    notif?.hiTypes ??
    cr?.hiTypes ??
    cr?.hi_types;
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

export function extractPurpose(payload: unknown): string | null {
  const p = payload as Record<string, unknown> | null;
  if (!p) return null;
  const purpose = p.purpose ?? (p.notification as Record<string, unknown> | undefined)?.purpose;
  if (typeof purpose === "string") return purpose;
  if (purpose && typeof purpose === "object") {
    const t = (purpose as { text?: string }).text;
    if (t?.trim()) return t.trim();
  }
  const notif = p.notification as Record<string, unknown> | undefined;
  const cr = notif?.consentRequest as Record<string, unknown> | undefined;
  const pr = cr?.purpose;
  if (pr && typeof pr === "object") {
    const t = (pr as { text?: string }).text;
    if (t?.trim()) return t.trim();
  }
  return null;
}

/** HIU / requester display (ABDM Health Data Management Policy, section 4.2). */
export function extractHiuDisplay(payload: unknown): string | null {
  const p = payload as Record<string, unknown> | null;
  if (!p) return null;
  const candidates = [
    p.hiuName,
    p.hiu_name,
    p.requesterName,
    (p.requester as Record<string, unknown> | undefined)?.name,
    (p.requester as Record<string, unknown> | undefined)?.display,
    (p.notification as Record<string, unknown> | undefined)?.hiuName,
    (p.notification as Record<string, unknown> | undefined)?.requester,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (c && typeof c === "object") {
      const n = (c as { name?: string }).name;
      if (typeof n === "string" && n.trim()) return n.trim();
    }
  }
  const hiuId = p.hiuId ?? p.hiu_id;
  if (hiuId != null && String(hiuId).trim()) return `HIU ${String(hiuId).trim()}`;
  return null;
}

export function extractValidityIst(payload: unknown): { from?: string; to?: string } {
  const p = payload as Record<string, unknown> | null;
  if (!p) return {};
  const validity =
    (p.validity as Record<string, unknown> | undefined) ??
    (p.notification as Record<string, unknown> | undefined)?.validity ??
    ((p.notification as Record<string, unknown> | undefined)?.consentRequest as Record<string, unknown> | undefined)
      ?.validity;
  if (!validity || typeof validity !== "object") return {};
  const v = validity as Record<string, unknown>;
  const fromRaw = v.fromDate ?? v.from ?? v.start;
  const toRaw = v.toDate ?? v.to ?? v.end;
  const fmt = (v: unknown) => {
    if (v == null) return undefined;
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  };
  return { from: fmt(fromRaw), to: fmt(toRaw) };
}
