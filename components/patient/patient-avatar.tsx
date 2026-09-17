"use client";

import { Droplet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { personInitialsDisplay } from "@/lib/personInitialsDisplay";
import { supabase } from "@/lib/supabase";

const BUCKET = "patient-photos";

const SIZE_PX = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80,
} as const;

export type PatientAvatarSize = keyof typeof SIZE_PX;

/** Deterministic hue 0–359 from UUID / id string */
export function patientIdHue(patientId: string): number {
  let h = 2166136261;
  for (let i = 0; i < patientId.length; i++) {
    h ^= patientId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0) % 360;
}

export function initialsFromPatientName(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return personInitialsDisplay(`${parts[0]!.charAt(0)}${parts[parts.length - 1]!.charAt(0)}`);
  }
  if (parts[0]!.length >= 2) return personInitialsDisplay(parts[0]!.slice(0, 2));
  return personInitialsDisplay(parts[0]!.charAt(0));
}

function ageFromDob(dob: string | undefined): number | null {
  if (!dob?.trim()) return null;
  const raw = dob.trim();
  const d = new Date(raw.length <= 10 ? `${raw}T12:00:00` : raw);
  if (Number.isNaN(d.getTime())) return null;
  const years = (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return Math.max(0, Math.floor(years));
}

export type PatientAvatarProps = {
  patientId: string;
  patientName: string;
  size?: PatientAvatarSize;
  showName?: boolean;
  showAge?: boolean;
  dob?: string;
  /** When set, preferred over age computed from `dob` */
  ageYears?: number | null;
  sex?: string;
  className?: string;
};

export function PatientAvatar({
  patientId,
  patientName,
  size = "md",
  showName = false,
  showAge = false,
  dob,
  ageYears,
  sex,
  className = "",
}: PatientAvatarProps) {
  const px = SIZE_PX[size];
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const hue = useMemo(() => patientIdHue(patientId.trim() || "unknown"), [patientId]);

  useEffect(() => {
    const id = patientId?.trim();
    if (!id) {
      setSignedUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(`${id}.jpg`, 3600);
      if (cancelled) return;
      if (error || !data?.signedUrl) {
        setSignedUrl(null);
        return;
      }
      setSignedUrl(data.signedUrl);
      setImgFailed(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const initials = initialsFromPatientName(patientName);
  const showFallback = !signedUrl || imgFailed;

  const age =
    ageYears != null && Number.isFinite(Number(ageYears))
      ? Math.round(Number(ageYears))
      : ageFromDob(dob);
  const sexShort = sex?.trim()
    ? sex.trim().length === 1
      ? sex.trim().toUpperCase()
      : sex.trim().charAt(0).toUpperCase() + sex.trim().slice(1).toLowerCase()
    : null;

  const circle = (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full ring-2 ring-white shadow ${className}`}
      style={{ width: px, height: px }}
    >
      {!showFallback ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={signedUrl!}
          alt=""
          width={px}
          height={px}
          className="h-full w-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-center font-bold text-white"
          style={{
            background: `linear-gradient(145deg, hsl(${hue} 48% 38%), hsl(${hue} 55% 28%))`,
            fontSize: Math.max(10, Math.round(px * 0.32)),
          }}
          aria-hidden
        >
          {initials}
        </div>
      )}
    </div>
  );

  if (!showName && !showAge) {
    return circle;
  }

  const metaParts: string[] = [];
  if (showAge) {
    if (age != null) metaParts.push(`${age}y`);
    if (sexShort) metaParts.push(sexShort);
  }

  return (
    <span className={`inline-flex max-w-full items-center gap-2 ${className}`}>
      {circle}
      <span className="min-w-0">
        {showName ? (
          <span className="block truncate font-semibold text-gray-900">{patientName || "Patient"}</span>
        ) : null}
        {showAge && metaParts.length > 0 ? (
          <span className="block text-xs text-gray-500">{metaParts.join(" · ")}</span>
        ) : null}
      </span>
    </span>
  );
}

export type PatientEncounterBannerProps = {
  patientId: string;
  patientName: string;
  ageYears?: number | null;
  sex?: string | null;
  docpadId?: string | null;
  /** e.g. "Ward 3 · Bed 12" when admitted */
  wardBed?: string | null;
  bloodGroup?: string | null;
  phone?: string | null;
  /** Right column (e.g. treating doctors block) */
  rightSlot?: React.ReactNode;
};

/**
 * Standard OPD encounter patient strip: photo + identity line + optional blood / phone.
 * Wrap with `sticky top-14 z-50` (or `top-0` under a fixed nav) at the page level.
 */
export function PatientEncounterBanner({
  patientId,
  patientName,
  ageYears,
  sex,
  docpadId,
  wardBed,
  bloodGroup,
  phone,
  rightSlot,
}: PatientEncounterBannerProps) {
  const sexLabel =
    sex != null && String(sex).trim() !== ""
      ? String(sex).trim().charAt(0).toUpperCase() + String(sex).trim().slice(1).toLowerCase()
      : null;

  const parts: string[] = [];
  if (ageYears != null && Number.isFinite(Number(ageYears))) {
    parts.push(`${ageYears} years`);
  }
  if (sexLabel) parts.push(sexLabel);
  const wb = wardBed?.trim();
  if (wb) parts.push(wb);
  if (docpadId?.trim()) parts.push(`DocPad ID: ${docpadId.trim()}`);

  const metaLine = parts.join(" • ");

  return (
    <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
      <div className="flex min-w-0 gap-4">
        <PatientAvatar patientId={patientId} patientName={patientName} size="lg" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">{patientName}</h1>
            {bloodGroup?.trim() ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs font-bold text-orange-700">
                <Droplet className="h-3 w-3" aria-hidden />
                {bloodGroup.trim()}
              </span>
            ) : null}
          </div>
          {metaLine ? <p className="mt-1 text-sm text-gray-600">{metaLine}</p> : null}
          {phone?.trim() ? (
            <p className="mt-0.5 text-sm text-gray-500">
              <a href={`tel:${phone.trim()}`} className="font-medium text-blue-600 hover:underline">
                {phone.trim()}
              </a>
            </p>
          ) : null}
        </div>
      </div>
      {rightSlot ? <div className="min-w-[220px] shrink-0">{rightSlot}</div> : null}
    </div>
  );
}
