"use client";

export type PrescriptionHeaderConfig = {
  clinic_name?: string | null;
  formerly?: string | null;
  doctor_name?: string | null;
  qualifications?: string | null;
  designation?: string | null;
  reg_number?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  timings?: string | null;
  footer_note?: string | null;
};

export type HospitalLetterheadData = {
  name: string;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logo_url?: string | null;
  tagline?: string | null;
  registration_no?: string | null;
  letterhead_color?: string | null;
  nabh_accredited?: boolean;
  nabh_certificate_number?: string | null;
  /** When non-null, print header uses this instead of tagline/registration/letterhead blocks from columns. */
  prescription_header_config?: PrescriptionHeaderConfig | null;
};

export type DoctorLineData = {
  full_name?: string | null;
  specialty?: string | null;
  registration_no?: string | null;
};

type Props = {
  hospital: HospitalLetterheadData;
  doctor?: DoctorLineData | null;
  /** Compact mode — smaller text, tighter spacing. Used in PrescriptionModal preview. */
  compact?: boolean;
};

function str(v: string | null | undefined): string {
  if (v == null) return "";
  return String(v).trim();
}

function normalizeHeaderConfig(raw: unknown): PrescriptionHeaderConfig | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return null;
    try {
      const p = JSON.parse(t) as unknown;
      if (typeof p === "object" && p !== null) return p as PrescriptionHeaderConfig;
    } catch {
      return null;
    }
    return null;
  }
  if (typeof raw === "object" && raw !== null) return raw as PrescriptionHeaderConfig;
  return null;
}

function PrescriptionHeaderConfigLayout({
  config,
  color,
  compact,
}: {
  config: PrescriptionHeaderConfig;
  color: string;
  compact: boolean;
}) {
  const title = compact ? "text-lg" : "text-2xl";
  const sub = compact ? "text-[9px]" : "text-xs";
  const right = compact ? "text-[10px]" : "text-sm";
  const contact = compact ? "text-[9px]" : "text-xs";
  const footer = compact ? "text-[9px]" : "text-[10px]";
  const qualLine = [str(config.qualifications), str(config.designation)].filter(Boolean).join(" · ");

  return (
    <div className="hospital-letterhead w-full">
      <style>{`
        @media print {
          @page { margin: 15mm; }
          .hospital-letterhead { background: transparent !important; color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      <div className={`grid grid-cols-3 items-start gap-2 ${compact ? "pb-2" : "pb-3"}`}>
        <div className="min-h-0 min-w-0" aria-hidden />
        <div className="min-w-0 text-center">
          {str(config.clinic_name) ? (
            <p className={`${title} font-bold leading-tight text-gray-900`}>{str(config.clinic_name)}</p>
          ) : null}
          {str(config.formerly) ? <p className={`${sub} mt-0.5 italic text-gray-500`}>{str(config.formerly)}</p> : null}
        </div>
        <div className={`min-w-0 text-right text-gray-800 ${right} space-y-0.5`}>
          {str(config.doctor_name) ? <p className="font-bold text-gray-900">{str(config.doctor_name)}</p> : null}
          {qualLine ? <p className="text-gray-700">{qualLine}</p> : null}
          {str(config.reg_number) ? <p className="text-gray-700">Reg. {str(config.reg_number)}</p> : null}
        </div>
      </div>

      <div style={{ borderTop: `2px solid ${color}` }} />

      <div className={`mt-1.5 flex flex-wrap items-start justify-between gap-3 ${contact} text-gray-600`}>
        <div className="min-w-0 space-y-0.5 text-left">
          {str(config.address) ? <p className="whitespace-pre-wrap">{str(config.address)}</p> : null}
          {str(config.phone) ? <p>{str(config.phone)}</p> : null}
          {str(config.email) ? <p>{str(config.email)}</p> : null}
        </div>
        {str(config.timings) ? (
          <div className="shrink-0 text-right text-gray-600">
            <p className="whitespace-pre-line">{str(config.timings)}</p>
          </div>
        ) : null}
      </div>

      {str(config.footer_note) ? (
        <p className={`${footer} mt-2 text-center italic text-gray-500`}>{str(config.footer_note)}</p>
      ) : null}
    </div>
  );
}

export function HospitalLetterhead({ hospital, doctor, compact = false }: Props) {
  const color = hospital.letterhead_color?.trim() || "#1d4ed8";

  const rawCfg = hospital.prescription_header_config;
  if (rawCfg != null) {
    const cfg = normalizeHeaderConfig(rawCfg);
    if (cfg)
      return <PrescriptionHeaderConfigLayout config={cfg} color={color} compact={compact} />;
  }

  const addressParts: string[] = [];
  if (hospital.address_line1?.trim()) addressParts.push(hospital.address_line1.trim());
  if (hospital.address_line2?.trim()) addressParts.push(hospital.address_line2.trim());
  const cityStateLine = [
    hospital.city?.trim(),
    hospital.state?.trim(),
  ]
    .filter(Boolean)
    .join(", ");
  const pincodeStr = hospital.pincode?.trim() ? ` — ${hospital.pincode.trim()}` : "";
  if (cityStateLine) addressParts.push(`${cityStateLine}${pincodeStr}`);

  const rawName = doctor?.full_name?.trim() ?? null;
  const doctorTitle =
    rawName
      ? rawName.startsWith("Dr.") || rawName.startsWith("Dr ")
        ? rawName
        : `Dr. ${rawName}`
      : null;

  const doctorLineParts = [
    doctorTitle,
    doctor?.specialty?.trim() || null,
    doctor?.registration_no?.trim() ? `Reg: ${doctor.registration_no.trim()}` : null,
  ].filter(Boolean);

  const nameSize = compact ? "text-base font-bold" : "text-xl font-bold";
  const taglineSize = compact ? "text-[10px]" : "text-xs";
  const contactSize = compact ? "text-[10px]" : "text-xs";
  const metaSize = compact ? "text-[9px]" : "text-[10px]";
  const doctorLineSize = compact ? "text-[10px]" : "text-xs";
  const gapY = compact ? "pb-2" : "pb-3";

  return (
    <div className="hospital-letterhead w-full">
      <style>{`
        @media print {
          @page { margin: 15mm; }
          .hospital-letterhead img { max-height: 80px !important; width: auto !important; }
          .hospital-letterhead { background: transparent !important; color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      {/* 3-column header */}
      <div className={`grid grid-cols-3 items-center gap-3 ${gapY}`}>
        {/* Left: Logo or large hospital name */}
        <div className="flex items-center">
          {hospital.logo_url?.trim() ? (
            <img
              src={hospital.logo_url.trim()}
              alt={`${hospital.name} logo`}
              className="max-h-[80px] w-auto object-contain print:max-h-[80px]"
              style={{ maxHeight: compact ? 56 : 80 }}
            />
          ) : (
            <p
              className="text-lg font-extrabold leading-tight"
              style={{ color }}
            >
              {hospital.name}
            </p>
          )}
        </div>

        {/* Center: Hospital name + tagline */}
        <div className="text-center">
          <p className={`${nameSize} leading-tight text-gray-900`} style={{ fontSize: compact ? 15 : 20 }}>
            {hospital.name}
          </p>
          {hospital.tagline?.trim() ? (
            <p className={`mt-0.5 ${taglineSize} italic text-gray-500`}>{hospital.tagline.trim()}</p>
          ) : null}
        </div>

        {/* Right: Contact details */}
        <div className={`text-right ${contactSize} text-gray-500 space-y-px`}>
          {addressParts.map((part, i) => (
            <p key={i}>{part}</p>
          ))}
          {hospital.phone?.trim() ? <p>{hospital.phone.trim()}</p> : null}
          {hospital.email?.trim() ? <p>{hospital.email.trim()}</p> : null}
          {hospital.website?.trim() ? <p>{hospital.website.trim()}</p> : null}
        </div>
      </div>

      {/* Full-width divider in brand color */}
      <div style={{ borderTop: `2px solid ${color}` }} />

      {/* Reg. No + NABH line */}
      {hospital.registration_no?.trim() || hospital.nabh_accredited ? (
        <div className={`mt-1 flex flex-wrap gap-x-4 ${metaSize} text-gray-500`}>
          {hospital.registration_no?.trim() ? (
            <span>Reg. No: {hospital.registration_no.trim()}</span>
          ) : null}
          {hospital.nabh_accredited ? (
            <span>
              NABH Accredited
              {hospital.nabh_certificate_number?.trim()
                ? ` — Cert: ${hospital.nabh_certificate_number.trim()}`
                : ""}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Doctor line */}
      {doctorLineParts.length > 0 ? (
        <p className={`mt-1.5 ${doctorLineSize} font-medium text-gray-700`}>
          {doctorLineParts.join(" | ")}
        </p>
      ) : null}
    </div>
  );
}
