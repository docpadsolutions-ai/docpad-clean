"use client";

import { ConsentNotificationBadge } from "./ConsentNotificationBadge";

export function AbdmConsentNotificationGate({ patientId }: { patientId: string }) {
  return <ConsentNotificationBadge patientId={patientId} />;
}
