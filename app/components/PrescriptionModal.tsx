"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { usePrescription } from "../hooks/usePrescription";
import type { CatalogEntry } from "../lib/medicineCatalog";
import { formatAbdmMedicationLabel, medicineCatalog } from "../lib/medicineCatalog";
import {
  catalogFromClinicalProposal,
  catalogFromRegistryRow,
  compareCatalogEntriesByInventoryStock,
  searchMedicationRegistry,
} from "../lib/medicationRegistry";
import { searchHospitalInventoryMedicines } from "../lib/hospitalInventoryCatalog";
import { insertMedicationProposal } from "../lib/medicationProposals";
import {
  addUserFavorite,
  catalogEntryFromFavoriteRow,
  catalogEntryFromHistoryRow,
  fetchRecentMedications,
  fetchUserFavorites,
  insertMedicationHistoryForEncounter,
  prefillFromHistoryRow,
  removeUserFavorite,
  type MedicationHistoryRow,
  type UserFavoriteRow,
} from "../lib/medicationWorkspace";
import type { PrescriptionLine, VoiceRxPrefillRow } from "../lib/prescriptionLine";
import { calculateTotalQuantity } from "../lib/medicationUtils";
import { buildManualCatalogEntry, MANUAL_ENTRY_CATALOG_STUB } from "../lib/manualMedicationCatalog";
import {
  estimatePrescribedQuantity,
  newPrescriptionLineId,
  prescriptionLineToDbRow,
  voiceRowToPrescriptionLine,
} from "../lib/prescriptionLine";
import { fetchAuthOrgId } from "../lib/authOrg";
import { parsePractitionerRoleColumn, type UserRole } from "../lib/userRole";
import { supabase } from "../supabase";
import ClinicalProposalModal, { type ClinicalProposalPayload } from "./ClinicalProposalModal";
import InlineDosageSelector from "./InlineDosageSelector";
import { usePermission } from "../hooks/usePermission";
import SaveTemplateModal from "./SaveTemplateModal";
import { PermissionSurface } from "./PermissionGate";
import {
  fetchRxTemplateItems,
  fetchRxTemplates,
  rxTemplateItemToPrescriptionLine,
  type RxTemplateRow,
} from "../lib/rxTemplates";
import {
  buildLabSummaryText,
  fetchCompletedLabOcrForEncounter,
  fetchLabResultEntriesForOcrUploads,
  fetchPrescriptionAttachmentsForEncounter,
  replacePrescriptionAttachmentsForEncounter,
  type LabResultEntryLite,
} from "../lib/prescriptionAttachments";

/** Structured rows from plan voice dictation — re-exported for encounter page. */
export type { VoiceRxPrefillRow } from "../lib/prescriptionLine";

/** Supabase table: one row per medication line, linked by `encounter_id` (same model as `opd_prescriptions` in many EMRs). */
const PRESCRIPTIONS_TABLE = "prescriptions";

type LabAttachSlot = {
  ocr_upload_id: string;
  investigation_id: string | null;
  display_name: string;
  report_date_label: string;
  checked: boolean;
  includeWhatsapp: boolean;
  includePrint: boolean;
};

type WorkspaceTab = "favorites" | "recent" | "previous" | "templates";

// ─── Icons ────────────────────────────────────────────────────────────────────

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
    </svg>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" strokeLinecap="round" />
    </svg>
  );
}

function PillIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M10.5 20H4a2 2 0 01-2-2V6a2 2 0 012-2h16a2 2 0 012 2v7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="17" cy="17" r="5" />
      <path d="M14.5 17h5" strokeLinecap="round" />
    </svg>
  );
}

function PrinterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </svg>
  );
}

function PharmacyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 22V12h6v10" strokeLinecap="round" />
    </svg>
  );
}

function LayersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M12 2L2 7l10 5 10-5-10-5z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** After prescription insert: decrement `hospital_inventory.stock_quantity` for stock-sourced lines only. */
async function deductHospitalInventoryForPrescription(
  lines: PrescriptionLine[],
  hospitalId: string | null,
): Promise<string | null> {
  if (!hospitalId?.trim()) return null;
  const hid = hospitalId.trim();
  const stockLines = lines.filter((l) => l.catalog.medication_source === "stock");
  if (stockLines.length === 0) return null;

  const errors: string[] = [];
  for (const line of stockLines) {
    const invId = line.catalog.id;
    const qty = estimatePrescribedQuantity(line);
    const { data: row, error: fetchErr } = await supabase
      .from("hospital_inventory")
      .select("stock_quantity")
      .eq("id", invId)
      .eq("hospital_id", hid)
      .maybeSingle();

    if (fetchErr) {
      errors.push(`${line.catalog.name}: ${fetchErr.message}`);
      continue;
    }
    if (!row) {
      errors.push(`${line.catalog.name}: inventory row not found`);
      continue;
    }
    const raw = (row as { stock_quantity: number | string | null }).stock_quantity;
    const current = typeof raw === "number" ? raw : parseInt(String(raw ?? "0"), 10);
    const cur = Number.isFinite(current) ? current : 0;
    const next = Math.max(0, cur - qty);
    const { error: upErr } = await supabase
      .from("hospital_inventory")
      .update({ stock_quantity: next })
      .eq("id", invId)
      .eq("hospital_id", hid);
    if (upErr) errors.push(`${line.catalog.name}: ${upErr.message}`);
  }
  return errors.length ? errors.join("; ") : null;
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.107.547 4.088 1.504 5.814L0 24l6.335-1.652A11.954 11.954 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.017-1.374l-.36-.214-3.727.972.993-3.62-.235-.372A9.818 9.818 0 0112 2.182c5.427 0 9.818 4.39 9.818 9.818 0 5.427-4.39 9.818-9.818 9.818z" />
    </svg>
  );
}

// ─── Medicine card ────────────────────────────────────────────────────────────

function isRegistryMedication(med: CatalogEntry): boolean {
  return med.medication_source === "registry" || Boolean(med.registry_id);
}

function isStockMedication(med: CatalogEntry): boolean {
  return med.medication_source === "stock";
}

function MedicineCard({
  med,
  onAdd,
  isFavorite,
  onToggleFavorite,
  favoriteBusy,
}: {
  med: CatalogEntry;
  onAdd: (m: CatalogEntry) => void;
  isFavorite: boolean;
  onToggleFavorite: (m: CatalogEntry) => void;
  favoriteBusy?: boolean;
}) {
  const fromRegistry = isRegistryMedication(med);
  const fromStock = isStockMedication(med);
  const lowStock = !fromRegistry && !fromStock && med.stock > 0 && med.stock < 100;
  const outOfStock = !fromRegistry && !fromStock && med.stock === 0 && !med.isTemplate;
  const genericLine = (med.generic_name ?? med.active_ingredient).trim();
  const formLine = (med.form_name ?? "").trim();
  const showCatalogSig =
    !fromRegistry && !fromStock && !med.isTemplate && Boolean((med.defaultFreq ?? "").trim() || (med.defaultDuration ?? "").trim());

  return (
    <div className="relative rounded-xl border border-blue-100 bg-blue-50/40 transition hover:border-blue-300 hover:bg-blue-50 hover:shadow-sm focus-within:ring-2 focus-within:ring-blue-400">
      <button
        type="button"
        onClick={() => onAdd(med)}
        className="group flex w-full flex-col gap-1.5 p-3 pr-10 text-left focus:outline-none"
      >
        <div className="flex items-start justify-between gap-1">
          <p className="min-w-0 flex-1 text-xs font-semibold leading-tight text-gray-900 group-hover:text-blue-800">
            {fromStock ? med.name : med.displayName}
          </p>
          {fromStock ? (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                med.stock > 0 ? "bg-emerald-200 text-emerald-900" : "bg-red-100 text-red-800"
              }`}
              title="In-house stock"
            >
              IN-HOUSE: {med.stock.toLocaleString("en-IN")}
            </span>
          ) : (
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                med.isTemplate
                  ? "bg-purple-100 text-purple-700"
                  : fromRegistry
                    ? "bg-teal-100 text-teal-800"
                    : "bg-blue-100 text-blue-700"
              }`}
            >
              {med.isTemplate
                ? "Template"
                : fromRegistry
                  ? med.stock > 0
                    ? `Registry · ${med.stock.toLocaleString("en-IN")} in stock`
                    : "Registry"
                  : "Single"}
            </span>
          )}
        </div>
        {fromStock && (genericLine || formLine) ? (
          <p className="text-[11px] leading-snug text-gray-600">
            <span className="font-medium text-gray-700">{genericLine || "—"}</span>
            {genericLine && formLine ? <span className="text-gray-400"> · </span> : null}
            {formLine ? <span className="text-gray-500">{formLine}</span> : null}
          </p>
        ) : null}
        {fromStock && (med.is_lasa || med.is_high_risk) ? (
          <p className="flex flex-wrap gap-1">
            {med.is_lasa ? (
              <span className="rounded bg-amber-100 px-1.5 py-px text-[9px] font-bold text-amber-900">LASA</span>
            ) : null}
            {med.is_high_risk ? (
              <span className="rounded bg-red-100 px-1.5 py-px text-[9px] font-bold text-red-800">High risk</span>
            ) : null}
          </p>
        ) : null}
        {fromRegistry && (genericLine || formLine) ? (
          <p className="text-[11px] leading-snug text-gray-600">
            <span className="font-medium text-gray-700">{genericLine || "—"}</span>
            {genericLine && formLine ? <span className="text-gray-400"> · </span> : null}
            {formLine ? <span className="text-gray-500">{formLine}</span> : null}
          </p>
        ) : null}
        {showCatalogSig && (
          <p className="text-[11px] text-gray-500">
            {med.defaultFreq} x {med.defaultDuration}
          </p>
        )}
        {!fromRegistry && !fromStock && med.stock > 0 && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className={`flex items-center gap-0.5 ${lowStock ? "text-amber-600" : "text-emerald-600"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${lowStock ? "bg-amber-400" : "bg-emerald-400"}`} />
              {med.stock.toLocaleString("en-IN")} left
            </span>
            <span className="text-gray-400">|</span>
            <span className="text-gray-500">₹{med.pricePerUnit.toFixed(2)}/tab</span>
          </div>
        )}
        {outOfStock && <p className="text-[11px] font-medium text-red-500">Out of stock</p>}
      </button>
      <button
        type="button"
        disabled={favoriteBusy}
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite(med);
        }}
        className="absolute right-1.5 top-1.5 rounded-lg p-1.5 text-gray-400 transition hover:bg-white/80 hover:text-amber-500 disabled:opacity-40"
      >
        <StarIcon
          className={`h-4 w-4 ${isFavorite ? "fill-amber-400 text-amber-500" : "text-gray-300"}`}
        />
      </button>
    </div>
  );
}

function PrescriptionChip({
  line,
  onEdit,
  onRemove,
  isFavorite,
  favoriteBusy,
  onToggleFavorite,
  flash,
  allowPrescribeEdits = true,
}: {
  line: PrescriptionLine;
  onEdit: (l: PrescriptionLine) => void;
  onRemove: (id: string) => void;
  isFavorite: boolean;
  favoriteBusy?: boolean;
  onToggleFavorite: () => void;
  flash?: boolean;
  allowPrescribeEdits?: boolean;
}) {
  const sig = [line.dosage, line.frequency, line.duration, `Total ${line.total_quantity}`]
    .filter((s) => s != null && String(s).trim() !== "")
    .join(" · ");
  const isStock = line.catalog.medication_source === "stock";

  return (
    <div
      className={`inline-flex max-w-full items-center justify-between gap-3 rounded-full border border-blue-200 bg-white text-left shadow-sm transition-[box-shadow,ring] duration-300 ${
        flash ? "z-10 ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-50 shadow-md shadow-blue-200/50" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => onEdit(line)}
        disabled={!allowPrescribeEdits}
        title={!allowPrescribeEdits ? "Only doctors can edit prescriptions." : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-l-full border-r border-blue-100 py-2 px-3 text-left transition hover:bg-blue-50/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-xs font-semibold text-gray-900">
            {formatAbdmMedicationLabel(line.catalog)}
          </span>
          {sig ? <span className="min-w-0 truncate text-[10px] text-gray-500">{sig}</span> : null}
        </div>
        {isStock ? (
          <span
            className={`ml-auto shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold tabular-nums ${
              line.catalog.stock > 0 ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
            }`}
          >
            IN-HOUSE: {line.catalog.stock}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        disabled={favoriteBusy}
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite();
        }}
        className="flex shrink-0 items-center justify-center py-2 px-3 text-gray-400 transition hover:bg-amber-50 hover:text-amber-500 disabled:opacity-40"
      >
        <StarIcon className={`h-3.5 w-3.5 ${isFavorite ? "fill-amber-400 text-amber-500" : "text-gray-300"}`} />
      </button>
      <button
        type="button"
        aria-label={`Remove ${formatAbdmMedicationLabel(line.catalog)}`}
        disabled={!allowPrescribeEdits}
        title={!allowPrescribeEdits ? "Only doctors can remove medications from this prescription." : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove(line.id);
        }}
        className="flex shrink-0 items-center justify-center rounded-r-full py-2 px-3 text-sm font-medium leading-none text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400"
      >
        ×
      </button>
    </div>
  );
}

function inventorySkuKey(c: CatalogEntry): string | null {
  if (c.medication_source === "stock") return `s:${c.id}`;
  if (c.registry_id) return `r:${c.registry_id}`;
  return null;
}

function committedQtyForSku(lines: PrescriptionLine[], key: string | null, excludeLineId: string): number {
  if (!key) return 0;
  return lines
    .filter((l) => l.id !== excludeLineId && inventorySkuKey(l.catalog) === key)
    .reduce((s, l) => s + estimatePrescribedQuantity(l), 0);
}

/** Units left on shelf for this SKU after other lines on the prescription (before this line’s quantity). */
function availableStockBeforeLine(line: PrescriptionLine, lines: PrescriptionLine[]): number {
  const c = line.catalog;
  const key = inventorySkuKey(c);
  const base = typeof c.stock === "number" && Number.isFinite(c.stock) ? Math.max(0, c.stock) : 0;
  const show = key != null || c.medication_source === "stock" || c.medication_source === "registry";
  if (!show) return Math.max(0, base);
  const other = committedQtyForSku(lines, key, line.id);
  return Math.max(0, base - other);
}

// ─── Main component ───────────────────────────────────────────────────────────

// A clinical entry can arrive as a plain string (legacy) or a FHIR-coded object.
type FhirEntry = string | { display: string; code?: string; icd10?: string | null };

// Extract the display label regardless of which shape was passed
function toDisplay(v: FhirEntry): string {
  return typeof v === "string" ? v : (v?.display ?? "");
}

// Extract an ICD-10 code if the FHIR object carries one
function toIcd10(v: FhirEntry): string | null {
  return typeof v === "string" ? null : (v?.icd10 ?? null);
}

function formatFollowUpForPrint(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd.trim();
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return new Date(y, mo - 1, d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Merge follow-up into `plan_details` and set `opd_encounters.follow_up_date`. */
async function persistEncounterFollowUp(
  eid: string,
  dateYmd: string | null | undefined,
): Promise<string | null> {
  const trimmed = dateYmd?.trim() || null;
  const { data: row, error: selErr } = await supabase
    .from("opd_encounters")
    .select("plan_details")
    .eq("id", eid)
    .maybeSingle();
  if (selErr) return selErr.message;
  const prev =
    row?.plan_details != null && typeof row.plan_details === "object" && !Array.isArray(row.plan_details)
      ? { ...(row.plan_details as Record<string, unknown>) }
      : {};
  const plan_details = { ...prev, follow_up_date: trimmed };
  const { error: upErr } = await supabase
    .from("opd_encounters")
    .update({
      follow_up_date: trimmed,
      plan_details,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eid);
  return upErr?.message ?? null;
}

export default function PrescriptionModal({
  isOpen,
  onClose,
  encounterId,
  patientId,
  patientName = "Patient",
  patientAge,
  patientSex,
  diagnosis,
  chiefComplaints = [],
  vitals = {},
  allergies = [],
  quickExam,
  procedures = [],
  advice,
  patientPhone,
  doctorName = "Doctor",
  /** `YYYY-MM-DD` — printed on Rx and persisted on save/finalize */
  followUpDate,
  /** Voice plan — applied to structured `addedMedicines` once when the modal opens */
  prefillMedicines,
  onPrefillApplied,
}: {
  isOpen: boolean;
  onClose: () => void;
  encounterId: string;
  patientId: string;
  patientName?: string;
  patientAge?: number | null;
  patientSex?: string | null;
  diagnosis?: FhirEntry | null;
  chiefComplaints?: FhirEntry[];
  vitals?: {
    weight?: string;
    bloodPressure?: string;
    pulse?: string;
    temperature?: string;
    spo2?: string;
  };
  allergies?: FhirEntry[];
  quickExam?: string;
  procedures?: FhirEntry[];
  advice?: string;
  patientPhone?: string | null;
  doctorName?: string;
  followUpDate?: string;
  prefillMedicines?: VoiceRxPrefillRow[];
  onPrefillApplied?: () => void;
}) {
  const [searchQuery, setSearchQuery]       = useState("");
  const [activeTab, setActiveTab]           = useState<WorkspaceTab>("favorites");
  const { hasPermission, loading: rxPermLoading } = usePermission();
  const rxView = hasPermission("prescriptions", "view");
  const rxEdit = hasPermission("prescriptions", "edit");
  const dispEdit = hasPermission("dispensing", "edit");
  const whatsappNotificationsEnabled = true;
  const [dispensingEncounterStatus, setDispensingEncounterStatus] = useState<"pending" | "prepared" | "dispensed">(
    "pending"
  );
  const { lines: addedMedicines, replaceAll, upsertLine, removeLine } = usePrescription([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const printRef       = useRef<HTMLDivElement>(null);
  const handlePrint    = useReactToPrint({ contentRef: printRef });
  const wasModalOpenRef = useRef(false);

  type InlineDraftState = { line: PrescriptionLine; isNew: boolean; variant: "catalog" | "manual" };
  const [inlineDraft, setInlineDraft] = useState<InlineDraftState | null>(null);
  const [manualMedicineName, setManualMedicineName] = useState("");
  const [flashLineId, setFlashLineId] = useState<string | null>(null);
  const manualNameRef = useRef<HTMLInputElement>(null);
  const chipAnchorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dosagePopoverRef = useRef<HTMLDivElement>(null);
  const dosageModalContainerRef = useRef<HTMLDivElement>(null);
  const rxWorkspaceLeftScrollRef = useRef<HTMLDivElement>(null);
  const newComposeContainerRef = useRef<HTMLDivElement>(null);
  const [dosagePopoverPos, setDosagePopoverPos] = useState<{ top: number; left: number } | null>(null);

  const confirmMedicationLines = useCallback(
    (lines: PrescriptionLine[]) => {
      for (const l of lines) upsertLine(l);
    },
    [upsertLine],
  );

  const cancelInlineDraft = useCallback(() => {
    setInlineDraft(null);
    setManualMedicineName("");
  }, []);

  const isDosageEditProtectedTarget = useCallback((target: Node) => {
    if (!inlineDraft || inlineDraft.isNew) return false;
    return chipAnchorRefs.current[inlineDraft.line.id]?.contains(target) ?? false;
  }, [inlineDraft]);

  const startInlineDraftFromCatalog = useCallback(
    (catalog: CatalogEntry, opts?: { prefill?: ReturnType<typeof prefillFromHistoryRow> | null }) => {
      const pre = opts?.prefill ?? null;
      const frequency = (pre?.frequency ?? catalog.defaultFreq ?? "").trim();
      const duration = (pre?.duration ?? catalog.defaultDuration ?? "").trim();
      const dosage = (pre?.dosage ?? catalog.defaultDose ?? "").trim();
      const line: PrescriptionLine = {
        id: newPrescriptionLineId(),
        catalog,
        dosage,
        frequency,
        duration,
        timing: (pre?.timing ?? "").trim(),
        instructions: (pre?.instructions ?? "").trim(),
        total_quantity: calculateTotalQuantity(frequency, duration),
      };
      setManualMedicineName("");
      setInlineDraft({ line, isNew: true, variant: "catalog" });
    },
    [],
  );

  const startInlineEdit = useCallback((line: PrescriptionLine) => {
    setManualMedicineName("");
    setInlineDraft({
      line: { ...line, catalog: { ...line.catalog } },
      isNew: false,
      variant: "catalog",
    });
  }, []);

  const beginManualAdd = useCallback(() => {
    setManualMedicineName("");
    setInlineDraft({
      line: {
        id: newPrescriptionLineId(),
        catalog: { ...MANUAL_ENTRY_CATALOG_STUB },
        dosage: "",
        frequency: "",
        duration: "",
        timing: "",
        instructions: "",
        total_quantity: 1,
      },
      isNew: true,
      variant: "manual",
    });
    window.setTimeout(() => manualNameRef.current?.focus(), 0);
  }, []);

  const beginFromFavorite = useCallback((row: UserFavoriteRow) => {
    const catalog = catalogEntryFromFavoriteRow(row);
    startInlineDraftFromCatalog(catalog);
  }, [startInlineDraftFromCatalog]);

  const beginFromRecentHistory = useCallback((row: MedicationHistoryRow) => {
    const catalog = catalogEntryFromHistoryRow(row);
    startInlineDraftFromCatalog(catalog, { prefill: prefillFromHistoryRow(row) });
  }, [startInlineDraftFromCatalog]);

  const pickMedicationFromFormularySearch = useCallback(
    (catalog: CatalogEntry) => {
      startInlineDraftFromCatalog(catalog);
    },
    [startInlineDraftFromCatalog],
  );

  const handleInlineDosageConfirm = useCallback(
    (partial: Partial<PrescriptionLine>) => {
      if (!inlineDraft) return;
      if (inlineDraft.variant === "manual" && !manualMedicineName.trim()) return;
      let catalog = inlineDraft.line.catalog;
      if (inlineDraft.variant === "manual") {
        catalog = buildManualCatalogEntry(manualMedicineName.trim());
      }
      const lockedDosage = (catalog.defaultDose ?? "").trim();
      const next: PrescriptionLine = {
        ...inlineDraft.line,
        ...partial,
        catalog,
        dosage: lockedDosage,
        timing: inlineDraft.line.timing.trim(),
      };
      upsertLine(next);
      const rid = next.id;
      setFlashLineId(rid);
      cancelInlineDraft();
      setSearchQuery("");
      window.requestAnimationFrame(() => {
        chipAnchorRefs.current[rid]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      window.setTimeout(() => {
        setFlashLineId((cur) => (cur === rid ? null : cur));
      }, 1000);
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    },
    [inlineDraft, manualMedicineName, upsertLine, cancelInlineDraft],
  );

  const [userId, setUserId] = useState<string | null>(null);
  const [favoritesList, setFavoritesList] = useState<UserFavoriteRow[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoritesError, setFavoritesError] = useState<string | null>(null);
  const [favoritesRefreshKey, setFavoritesRefreshKey] = useState(0);
  const [favoriteBusyKey, setFavoriteBusyKey] = useState<string | null>(null);

  const [recentList, setRecentList] = useState<MedicationHistoryRow[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentRefreshKey, setRecentRefreshKey] = useState(0);
  const [registryRows, setRegistryRows] = useState<CatalogEntry[]>([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  /** Neutral hint (gray only) — no amber “registry” error banner for in-house search. */
  const [hospitalSearchHint, setHospitalSearchHint] = useState<string | null>(null);
  const registrySearchSeqRef = useRef(0);
  const [clinicalProposalOpen, setClinicalProposalOpen] = useState(false);
  const [proposalSubmitting, setProposalSubmitting] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [saveTemplateModalOpen, setSaveTemplateModalOpen] = useState(false);
  const [templateToast, setTemplateToast] = useState<string | null>(null);
  const [templatesList, setTemplatesList] = useState<RxTemplateRow[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templatesRefreshKey, setTemplatesRefreshKey] = useState(0);
  const [injectingTemplateId, setInjectingTemplateId] = useState<string | null>(null);
  const [isSaving, setIsSaving]                   = useState(false);
  const [saveError, setSaveError]                 = useState<string | null>(null);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
  const [whatsAppSuccess, setWhatsAppSuccess]     = useState(false);
  const [prescriptionSaved, setPrescriptionSaved] = useState(false);
  const [savedRxId, setSavedRxId]                 = useState<string | null>(null);
  const [labAttachSlots, setLabAttachSlots]       = useState<LabAttachSlot[]>([]);
  const [labEntriesByOcrUploadId, setLabEntriesByOcrUploadId] = useState<Record<string, LabResultEntryLite[]>>({});
  const [labAttachLoading, setLabAttachLoading]   = useState(false);
  const [labAttachError, setLabAttachError]       = useState<string | null>(null);

  // Doctor profile (fetched dynamically)
  type DoctorProfile = {
    first_name: string | null;
    last_name: string | null;
    specialty: string | null;
    qualification: string | null;
    registration_no: string | null;
    role?: UserRole | null;
  };
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  /** From `auth_org()` — registry search + org name. */
  const [sessionOrgId, setSessionOrgId] = useState<string | null>(null);

  // Reset on open + fetch doctor profile + apply voice Rx prefill (snapshot on open only)
  useEffect(() => {
    if (!isOpen) {
      wasModalOpenRef.current = false;
      setSessionOrgId(null);
      return;
    }

    const justOpened = !wasModalOpenRef.current;
    wasModalOpenRef.current = true;

    if (justOpened) {
      const rows = prefillMedicines ?? [];
      replaceAll(rows.map((r, i) => voiceRowToPrescriptionLine(r, i)));
      setInlineDraft(null);
      setManualMedicineName("");
      setSaveTemplateModalOpen(false);
      if (rows.length > 0) onPrefillApplied?.();

      setSearchQuery("");
      setActiveTab("favorites");
      setSaveError(null);
      setPrescriptionSaved(false);
      setSavedRxId(null);
      setWhatsAppSuccess(false);
      setTimeout(() => searchInputRef.current?.focus(), 50);

      supabase.auth.getUser().then(({ data: authData }) => {
        const uid = authData.user?.id ?? null;
        setUserId(uid);
        if (!uid) return;
        supabase
          .from("practitioners")
          .select("first_name, last_name, full_name, specialty, qualification, registration_no, role, user_role")
          .or(`id.eq.${uid},user_id.eq.${uid}`)
          .maybeSingle()
          .then(({ data: profile }) => {
            if (!profile) return;
            const roleRaw =
              (profile as { user_role?: string | null; role?: string | null }).user_role ??
              (profile as { role?: string | null }).role;
            setDoctorProfile({
              first_name: profile.first_name ?? null,
              last_name: profile.last_name ?? null,
              specialty: profile.specialty ?? null,
              qualification: profile.qualification ?? null,
              registration_no: profile.registration_no ?? null,
              role: parsePractitionerRoleColumn(roleRaw),
            });
          });
        void fetchAuthOrgId().then(({ orgId: oid }) => {
          setSessionOrgId(oid);
          if (!oid) return;
          supabase
            .from("organizations")
            .select("name")
            .eq("id", oid)
            .maybeSingle()
            .then(({ data: org }) => {
              if (org?.name) setOrganizationName(org.name);
            });
        });
      });
    }
  }, [isOpen, prefillMedicines, onPrefillApplied, replaceAll]);

  useEffect(() => {
    if (!isOpen || !encounterId?.trim()) {
      if (!isOpen) {
        setLabAttachSlots([]);
        setLabEntriesByOcrUploadId({});
        setLabAttachError(null);
        setLabAttachLoading(false);
      }
      return;
    }
    let cancelled = false;
    const eid = encounterId.trim();
    setLabAttachLoading(true);
    setLabAttachError(null);
    void (async () => {
      const [{ rows: completed, error: e1 }, { rows: existing, error: e2 }] = await Promise.all([
        fetchCompletedLabOcrForEncounter(eid),
        fetchPrescriptionAttachmentsForEncounter(eid),
      ]);
      if (cancelled) return;
      setLabAttachLoading(false);
      const err = e1 || e2;
      if (err) {
        setLabAttachError(err);
        setLabAttachSlots([]);
        setLabEntriesByOcrUploadId({});
        return;
      }
      const existingByOcr = new Map(existing.map((r) => [r.ocr_upload_id, r]));
      const hadSaved = existing.length > 0;
      const slots: LabAttachSlot[] = completed.map((c) => {
        const ex = existingByOcr.get(c.ocr_upload_id);
        return {
          ocr_upload_id: c.ocr_upload_id,
          investigation_id: c.investigation_id,
          display_name: c.display_name,
          report_date_label: c.report_date_label,
          checked: hadSaved ? Boolean(ex) : true,
          includeWhatsapp: ex?.include_in_whatsapp ?? true,
          includePrint: ex?.include_in_print ?? true,
        };
      });
      setLabAttachSlots(slots);
      const ocrIds = completed.map((c) => c.ocr_upload_id);
      const { byUploadId, error: e3 } = await fetchLabResultEntriesForOcrUploads(ocrIds);
      if (cancelled) return;
      if (e3) setLabAttachError(e3);
      setLabEntriesByOcrUploadId(byUploadId);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, encounterId]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  // Keyboard close (child modals use capture + stopPropagation for Escape)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (saveTemplateModalOpen || clinicalProposalOpen) return;
      if (inlineDraft) {
        setInlineDraft(null);
        setManualMedicineName("");
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, inlineDraft, saveTemplateModalOpen, clinicalProposalOpen]);

  useEffect(() => {
    if (!templateToast) return;
    const t = window.setTimeout(() => setTemplateToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [templateToast]);

  useEffect(() => {
    if (!isOpen || activeTab !== "templates") return;
    let cancelled = false;
    (async () => {
      setTemplatesLoading(true);
      setTemplatesError(null);
      const { data, error } = await fetchRxTemplates();
      if (cancelled) return;
      setTemplatesLoading(false);
      if (error) {
        setTemplatesError(error.message);
        setTemplatesList([]);
      } else {
        setTemplatesList(data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeTab, templatesRefreshKey]);

  useEffect(() => {
    if (!isOpen || activeTab !== "previous") {
      setRegistryRows([]);
      setRegistryLoading(false);
      setHospitalSearchHint(null);
      return;
    }
    const q = searchQuery.trim();
    if (q.length < 2) {
      setRegistryRows([]);
      setHospitalSearchHint(null);
      setRegistryLoading(false);
      return;
    }

    setRegistryLoading(true);
    setHospitalSearchHint(null);
    const t = window.setTimeout(() => {
      const seq = ++registrySearchSeqRef.current;

      void (async () => {
        const regPromise = searchMedicationRegistry(q, { limit: 40, hospitalId: sessionOrgId });
        const stockPromise = sessionOrgId
          ? searchHospitalInventoryMedicines(sessionOrgId, q, { limit: 50 })
          : Promise.resolve({ data: [] as CatalogEntry[], error: null as Error | null });

        const [regRes, stockRes] = await Promise.all([regPromise, stockPromise]);

        if (seq !== registrySearchSeqRef.current) return;
        setRegistryLoading(false);

        const regErr = regRes.error;
        const stockErr = stockRes.error;

        if (regErr && stockErr) {
          console.error("formulary search:", regErr.message, stockErr.message);
          setRegistryRows([]);
          setHospitalSearchHint("Could not search registry or in-house stock. Check your connection.");
          return;
        }

        if (stockErr && sessionOrgId) {
          console.warn("hospital_inventory search:", stockErr.message);
        }
        if (regErr) {
          console.warn("hospital_inventory formulary search:", regErr.message);
        }

        const stockCats = stockRes.data ?? [];
        const regCats = (regRes.data ?? []).map((row) => catalogFromRegistryRow(row, sessionOrgId));

        const seen = new Set(
          stockCats.map(
            (c) =>
              `${(c.brand_name ?? c.name).toLowerCase()}|${(c.generic_name ?? c.active_ingredient ?? "").toLowerCase()}`,
          ),
        );
        const regFiltered = regCats.filter((c) => {
          const k = `${(c.brand_name ?? c.name).toLowerCase()}|${(c.generic_name ?? c.active_ingredient ?? "").toLowerCase()}`;
          return !seen.has(k);
        });

        setHospitalSearchHint(
          !sessionOrgId ? "Organization not loaded — showing registry only. In-house stock appears when your session is ready." : null,
        );

        const merged = [...stockCats, ...regFiltered];
        merged.sort(compareCatalogEntriesByInventoryStock);
        setRegistryRows(merged);
      })();
    }, 300);
    return () => window.clearTimeout(t);
  }, [isOpen, activeTab, searchQuery, sessionOrgId]);

  useEffect(() => {
    if (!isOpen || !userId) return;
    let cancelled = false;
    (async () => {
      setFavoritesLoading(true);
      setFavoritesError(null);
      const { data, error } = await fetchUserFavorites(userId);
      if (cancelled) return;
      setFavoritesLoading(false);
      if (error) {
        setFavoritesError(error.message);
        setFavoritesList([]);
      } else {
        setFavoritesList(data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, userId, favoritesRefreshKey]);

  useEffect(() => {
    if (!isOpen || !userId || activeTab !== "recent") return;
    let cancelled = false;
    (async () => {
      setRecentLoading(true);
      setRecentError(null);
      const { data, error } = await fetchRecentMedications(userId, 20);
      if (cancelled) return;
      setRecentLoading(false);
      if (error) {
        setRecentError(error.message);
        setRecentList([]);
      } else {
        setRecentList(data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, userId, activeTab, recentRefreshKey]);

  async function handleInjectTemplate(templateId: string) {
    setInjectingTemplateId(templateId);
    setTemplatesError(null);
    const { data, error } = await fetchRxTemplateItems(templateId);
    setInjectingTemplateId(null);
    if (error) {
      setTemplatesError(error.message);
      return;
    }
    const lines = data.map((row, i) => rxTemplateItemToPrescriptionLine(row, i));
    confirmMedicationLines(lines);
  }

  function findFavoriteRow(med: CatalogEntry): UserFavoriteRow | undefined {
    if (medicineCatalog.some((c) => c.id === med.id)) {
      return favoritesList.find((f) => f.catalog_medication_id === med.id);
    }
    if (med.medication_source === "stock") {
      return favoritesList.find((f) => f.catalog_medication_id === med.id);
    }
    if (med.registry_id) {
      return favoritesList.find((f) => f.catalog_medication_id === med.registry_id);
    }
    return favoritesList.find((f) => f.medicine_name === med.name);
  }

  function medFavoriteBusyKey(med: CatalogEntry): string {
    return `${med.id}\0${med.name}`;
  }

  async function handleToggleFavoriteMed(med: CatalogEntry) {
    if (!userId) return;
    setFavoriteBusyKey(medFavoriteBusyKey(med));
    setFavoritesError(null);
    const existing = findFavoriteRow(med);
    try {
      if (existing) {
        const { error } = await removeUserFavorite(userId, existing.id);
        if (error) setFavoritesError(error.message);
      } else {
        const { error } = await addUserFavorite(userId, med);
        if (error) setFavoritesError(error.message);
      }
      setFavoritesRefreshKey((k) => k + 1);
    } finally {
      setFavoriteBusyKey(null);
    }
  }

  async function handleUnfavoriteRow(row: UserFavoriteRow) {
    if (!userId) return;
    setFavoriteBusyKey(row.id);
    setFavoritesError(null);
    try {
      const { error } = await removeUserFavorite(userId, row.id);
      if (error) setFavoritesError(error.message);
      setFavoritesRefreshKey((k) => k + 1);
    } finally {
      setFavoriteBusyKey(null);
    }
  }

  async function handleClinicalProposalSubmit(payload: ClinicalProposalPayload) {
    setProposalError(null);
    if (!patientId?.trim()) {
      setProposalError("Patient context is missing.");
      return;
    }
    setProposalSubmitting(true);
    const { error } = await insertMedicationProposal({
      patient_id: patientId,
      encounter_id: encounterId?.trim() ? encounterId : null,
      brand_name: payload.brandName,
      generic_name: payload.genericName,
      dosage_form_code: payload.dosageFormCode,
      dosage_form_name: payload.dosageFormName,
      proposed_by: userId,
      verification_status: "pending",
    });
    setProposalSubmitting(false);
    if (error) {
      setProposalError(error.message);
      return;
    }
    const catalog = catalogFromClinicalProposal({
      brandName: payload.brandName,
      genericName: payload.genericName,
      dosageFormCode: payload.dosageFormCode,
      dosageFormName: payload.dosageFormName,
    });
    setClinicalProposalOpen(false);
    startInlineDraftFromCatalog(catalog);
  }

  const qLower = searchQuery.trim().toLowerCase();
  const filteredFavorites = favoritesList.filter((f) => {
    if (!qLower) return true;
    const a = (f.medicine_display_name ?? f.medicine_name).toLowerCase();
    const b = (f.medicine_name ?? "").toLowerCase();
    return a.includes(qLower) || b.includes(qLower);
  });

  const filteredRecent = recentList.filter((r) => {
    if (!qLower) return true;
    return r.medicine_name.toLowerCase().includes(qLower);
  });

  async function persistMedicationHistoryAfterSave(uid: string) {
    const { error } = await insertMedicationHistoryForEncounter(addedMedicines, uid, encounterId);
    if (error) console.error("medication_history insert:", error);
    setRecentRefreshKey((k) => k + 1);
  }

  async function persistPrescriptionAttachments(): Promise<string | null> {
    if (!userId?.trim() || !encounterId?.trim() || !patientId?.trim()) return null;
    const eid = encounterId.trim();
    const pid = patientId.trim();
    const checked = labAttachSlots.filter((s) => s.checked);
    if (checked.length === 0) {
      const { error } = await supabase.from("prescription_attachments").delete().eq("encounter_id", eid);
      return error?.message ?? null;
    }
    let hid: string | null = sessionOrgId?.trim() ?? null;
    if (!hid) {
      const { data } = await supabase.from("opd_encounters").select("hospital_id").eq("id", eid).maybeSingle();
      hid = data?.hospital_id != null ? String(data.hospital_id).trim() || null : null;
    }
    const { error } = await replacePrescriptionAttachmentsForEncounter({
      encounterId: eid,
      patientId: pid,
      hospitalId: hid,
      userId: userId.trim(),
      attachments: checked.map((s) => ({
        investigation_id: s.investigation_id,
        ocr_upload_id: s.ocr_upload_id,
        display_name: s.display_name,
        include_in_whatsapp: s.includeWhatsapp,
        include_in_print: s.includePrint,
      })),
    });
    return error ?? null;
  }

  function labSummaryItemsForPrint() {
    return labAttachSlots
      .filter((s) => s.checked && s.includePrint)
      .map((s) => ({
        displayName: `${s.display_name} — ${s.report_date_label}`,
        entries: labEntriesByOcrUploadId[s.ocr_upload_id] ?? [],
      }))
      .filter((it) => it.entries.length > 0);
  }

  function labSummaryTextForWhatsapp(): string {
    const items = labAttachSlots
      .filter((s) => s.checked && s.includeWhatsapp)
      .map((s) => ({
        displayName: `${s.display_name} — ${s.report_date_label}`,
        entries: labEntriesByOcrUploadId[s.ocr_upload_id] ?? [],
      }))
      .filter((it) => it.entries.length > 0);
    return buildLabSummaryText(items);
  }

  const handleRemoveLine = useCallback(
    (id: string) => {
      if (inlineDraft?.line.id === id) {
        setInlineDraft(null);
        setManualMedicineName("");
      }
      removeLine(id);
    },
    [inlineDraft, removeLine],
  );

  async function handleSavePrescription() {
    if (inlineDraft) {
      setSaveError("Finish or cancel the inline medication entry before saving.");
      return;
    }
    if (addedMedicines.length === 0) {
      setSaveError("Add at least one medicine before saving.");
      return;
    }
    if (!encounterId || !patientId) {
      setSaveError("Missing encounter or patient ID. Please try again.");
      return;
    }

    setSaveError(null);
    setIsSaving(true);

    const payload = addedMedicines.map((line) => prescriptionLineToDbRow(line, encounterId, patientId));

    const { error } = await supabase.from(PRESCRIPTIONS_TABLE).insert(payload);

    setIsSaving(false);

    if (error) {
      console.error("Prescription save failed:", error);
      setSaveError(error.message);
      return;
    }

    const fuErr = await persistEncounterFollowUp(encounterId, followUpDate ?? null);
    if (fuErr) console.warn("Could not persist follow-up on encounter:", fuErr);

    const invErr = await deductHospitalInventoryForPrescription(addedMedicines, sessionOrgId);
    if (invErr) console.error("hospital_inventory deduction:", invErr);

    if (userId) void persistMedicationHistoryAfterSave(userId);

    const attachErr = await persistPrescriptionAttachments();
    if (attachErr) console.warn("prescription_attachments:", attachErr);

    setPrescriptionSaved(true);
    setSavedRxId(encounterId);
    handlePrint();
    onClose();
  }

  async function handleWhatsAppSend() {
    if (!patientPhone) {
      setSaveError("No phone number on file for this patient.");
      return;
    }

    setSaveError(null);
    setIsSendingWhatsApp(true);

    // Save prescription first if not already done
    let rxId = savedRxId;
    if (!prescriptionSaved) {
      if (inlineDraft) {
        setSaveError("Finish or cancel the inline medication entry before sending.");
        setIsSendingWhatsApp(false);
        return;
      }
      if (addedMedicines.length === 0) {
        setSaveError("Add at least one medicine before sending.");
        setIsSendingWhatsApp(false);
        return;
      }
      if (!encounterId || !patientId) {
        setSaveError("Missing encounter or patient ID.");
        setIsSendingWhatsApp(false);
        return;
      }

      const payload = addedMedicines.map((line) => prescriptionLineToDbRow(line, encounterId, patientId));

      const { error } = await supabase.from(PRESCRIPTIONS_TABLE).insert(payload);
      if (error) {
        setSaveError(error.message);
        setIsSendingWhatsApp(false);
        return;
      }
      const fuErr = await persistEncounterFollowUp(encounterId, followUpDate ?? null);
      if (fuErr) console.warn("Could not persist follow-up on encounter:", fuErr);
      const invErr = await deductHospitalInventoryForPrescription(addedMedicines, sessionOrgId);
      if (invErr) console.error("hospital_inventory deduction:", invErr);
      if (userId) void persistMedicationHistoryAfterSave(userId);
      const attachErr = await persistPrescriptionAttachments();
      if (attachErr) console.warn("prescription_attachments:", attachErr);
      setPrescriptionSaved(true);
      rxId = encounterId;
      setSavedRxId(rxId);
    } else {
      const attachErr = await persistPrescriptionAttachments();
      if (attachErr) console.warn("prescription_attachments:", attachErr);
    }

    try {
      const labSummaryText = labSummaryTextForWhatsapp();
      const res = await fetch("/api/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone:       patientPhone,
          patientName,
          rxId:        rxId ?? encounterId,
          doctorName,
          labSummaryText: labSummaryText.trim() || undefined,
        }),
      });
      const json = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || json.error) {
        setSaveError(json.error ?? "Failed to send WhatsApp message.");
      } else {
        setWhatsAppSuccess(true);
        setTimeout(() => setWhatsAppSuccess(false), 4000);
      }
    } catch {
      setSaveError("Network error — could not reach WhatsApp API.");
    } finally {
      setIsSendingWhatsApp(false);
    }
  }

  useEffect(() => {
    if (!isOpen || !inlineDraft || inlineDraft.isNew) {
      setDosagePopoverPos(null);
      return;
    }
    const lineId = inlineDraft.line.id;
    const anchor = chipAnchorRefs.current[lineId];
    const modal = dosageModalContainerRef.current;
    if (!anchor || !modal) {
      setDosagePopoverPos(null);
      return;
    }
    const leftScrollEl = rxWorkspaceLeftScrollRef.current;

    const update = () => {
      const a = chipAnchorRefs.current[lineId];
      const m = dosageModalContainerRef.current;
      const pop = dosagePopoverRef.current;
      if (!a || !m) return;
      const ar = a.getBoundingClientRect();
      const mr = m.getBoundingClientRect();
      const pr = pop?.getBoundingClientRect() ?? { height: 280, width: 480 };
      const margin = 6;
      const minW = 420;
      const maxW = 560;
      const width = Math.min(maxW, Math.max(minW, pr.width));
      let top = ar.bottom - mr.top + margin;
      let left = ar.left - mr.left;
      const pad = 8;
      if (left + width > mr.width - pad) left = Math.max(pad, mr.width - pad - width);
      if (left < pad) left = pad;
      if (top + pr.height > mr.height - pad && ar.top - mr.top - pr.height - margin >= pad) {
        top = ar.top - mr.top - pr.height - margin;
      }
      if (top + pr.height > mr.height - pad) {
        top = Math.max(pad, mr.height - pad - pr.height);
      }
      setDosagePopoverPos({ top, left });
    };

    const raf = requestAnimationFrame(update);
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(update);
    });
    ro.observe(anchor);
    const pop = dosagePopoverRef.current;
    if (pop) ro.observe(pop);
    ro.observe(modal);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    leftScrollEl?.addEventListener("scroll", update, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      leftScrollEl?.removeEventListener("scroll", update);
    };
  }, [isOpen, inlineDraft]);

  if (!isOpen) return null;

  // ── Derived doctor display values ────────────────────────────────────────────
  const doctorFullName = doctorProfile
    ? [doctorProfile.first_name, doctorProfile.last_name].filter(Boolean).join(" ") || "Doctor"
    : doctorName;  // fall back to the prop passed from EncounterPage
  const doctorTitle        = doctorFullName.startsWith("Dr.") ? doctorFullName : `Dr. ${doctorFullName}`;
  const doctorQualification = doctorProfile?.qualification?.trim() || "MBBS";
  const doctorSpecialty    = doctorProfile?.specialty?.trim() || "General Medicine";
  const doctorRegNo        = doctorProfile?.registration_no?.trim() || null;
  const clinicDisplayName  = organizationName || "DocPad Health Clinic";

  // Profile incomplete warning — shown if reg no is missing
  const profileIncomplete  = doctorProfile !== null && !doctorRegNo;

  // Patient ID display — use first 8 chars of UUID if no real DocPad ID passed
  const patientDisplayId   = patientId
    ? `DCP-${patientId.replace(/-/g, "").slice(0, 6).toUpperCase()}`
    : "DCP-XXXXXX";

  // Date formatted as DD/MM/YYYY (India standard)
  const todayStr = new Date().toLocaleDateString("en-IN", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });

  const workspaceTabs: { id: WorkspaceTab; label: string; Icon: typeof StarIcon }[] = [
    { id: "favorites", label: "My Favorites", Icon: StarIcon },
    { id: "recent", label: "Recent 20", Icon: ClockIcon },
    { id: "previous", label: "In-house", Icon: ClockIcon },
    { id: "templates", label: "Templates", Icon: LayersIcon },
  ];

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      aria-modal="true"
      role="dialog"
      onClick={(e) => {
        if (saveTemplateModalOpen || clinicalProposalOpen) return;
        if (inlineDraft) {
          if (e.target === e.currentTarget) {
            setInlineDraft(null);
            setManualMedicineName("");
          }
          return;
        }
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dosageModalContainerRef}
        className="relative flex max-h-[95dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >

        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Prescription for {patientName}</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {patientAge != null && patientSex ? `${patientAge}Y / ${patientSex.charAt(0).toUpperCase()}` : ""}
              {diagnosis && toDisplay(diagnosis).trim()
                ? <> &nbsp;·&nbsp; <span className="font-medium">Dx:</span> {toDisplay(diagnosis)}</>
                : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_380px]">

          {/* ─── Left: Workspace ─── */}
          <div ref={rxWorkspaceLeftScrollRef} className="flex flex-col overflow-y-auto border-r border-gray-100 p-5">
            <PermissionSurface
              viewAllowed={rxView}
              editAllowed={rxEdit}
              loading={rxPermLoading}
              presentationWhenViewOnly="fieldset"
              deniedTitle="View-only access for your role."
            >
            <div className="flex min-w-0 flex-col">
            {/* Search */}
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
              <SearchIcon className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  activeTab === "previous"
                    ? "Search registry & in-house stock — brand or generic (min. 2 letters)…"
                    : "Filter this tab…"
                }
                className="flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
              />
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <button
                type="button"
                onClick={() => beginManualAdd()}
                className="text-left text-xs font-semibold text-blue-700 hover:underline"
              >
                + Type custom medicine…
              </button>
              <button
                type="button"
                onClick={() => {
                  setProposalError(null);
                  setClinicalProposalOpen(true);
                }}
                className="text-left text-xs font-semibold text-violet-700 hover:underline"
              >
                + Drug not in registry? Clinical proposal (ABDM / FHIR)
              </button>
            </div>

            {/* Workspace tabs */}
            <div className="mt-4 flex items-center gap-1 border-b border-gray-100">
              {workspaceTabs.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-semibold transition ${
                    activeTab === id
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {/* Medicine grid OR saved templates */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {activeTab === "templates" ? (
                <>
                  {templatesLoading && (
                    <div className="col-span-3 py-8 text-center text-sm text-gray-500">Loading templates…</div>
                  )}
                  {!templatesLoading && templatesError && (
                    <div className="col-span-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {templatesError}
                      <p className="mt-1 text-xs text-amber-800/90">
                        Ensure tables <code className="rounded bg-white/80 px-1">rx_templates</code> and{" "}
                        <code className="rounded bg-white/80 px-1">rx_template_items</code> exist (see{" "}
                        <code className="rounded bg-white/80 px-1">app/lib/rxTemplates.ts</code>).
                      </p>
                    </div>
                  )}
                  {!templatesLoading && !templatesError && templatesList.length === 0 && (
                    <div className="col-span-3 py-8 text-center text-sm text-gray-400">No saved templates yet.</div>
                  )}
                  {!templatesLoading &&
                    !templatesError &&
                    templatesList.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        disabled={injectingTemplateId !== null}
                        onClick={() => void handleInjectTemplate(t.id)}
                        className="group flex flex-col gap-1 rounded-xl border border-violet-100 bg-violet-50/50 p-3 text-left transition hover:border-violet-300 hover:bg-violet-50 hover:shadow-sm disabled:cursor-wait disabled:opacity-60"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <p className="text-xs font-semibold leading-tight text-gray-900 group-hover:text-violet-900">
                            {injectingTemplateId === t.id ? "Loading…" : t.template_name}
                          </p>
                          <LayersIcon className="h-4 w-4 shrink-0 text-violet-500" />
                        </div>
                        <p className="text-[10px] text-violet-700/80">Tap to add bundle to prescription</p>
                      </button>
                    ))}
                </>
              ) : activeTab === "favorites" ? (
                <>
                  {favoritesLoading && (
                    <div className="col-span-3 py-8 text-center text-sm text-gray-500">Loading favorites…</div>
                  )}
                  {!favoritesLoading && favoritesError && (
                    <div className="col-span-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {favoritesError}
                      <p className="mt-1 text-xs text-amber-800/90">
                        Ensure table <code className="rounded bg-white/80 px-1">user_favorites</code> exists (see{" "}
                        <code className="rounded bg-white/80 px-1">app/lib/medicationWorkspace.ts</code>).
                      </p>
                    </div>
                  )}
                  {!favoritesLoading && !favoritesError && filteredFavorites.length === 0 && (
                    <div className="col-span-3 py-8 text-center text-sm text-gray-400">
                      No favorites yet. Star a drug from your lists or in-house search.
                    </div>
                  )}
                  {!favoritesLoading &&
                    !favoritesError &&
                    filteredFavorites.map((row) => {
                      const label = row.medicine_display_name?.trim() || row.medicine_name;
                      return (
                        <div
                          key={row.id}
                          className="relative rounded-xl border border-amber-100 bg-amber-50/40 transition hover:border-amber-300 hover:bg-amber-50/80 hover:shadow-sm"
                        >
                          <button
                            type="button"
                            onClick={() => beginFromFavorite(row)}
                            className="flex w-full flex-col gap-1 p-3 pr-10 text-left focus:outline-none focus:ring-2 focus:ring-amber-400"
                          >
                            <p className="text-xs font-semibold leading-tight text-gray-900">{label}</p>
                            <p className="text-[10px] text-amber-800/80">Tap to set dosage &amp; add</p>
                          </button>
                          <button
                            type="button"
                            disabled={favoriteBusyKey === row.id}
                            aria-label="Remove from favorites"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void handleUnfavoriteRow(row);
                            }}
                            className="absolute right-1.5 top-1.5 rounded-lg p-1.5 text-amber-600 transition hover:bg-white/80 disabled:opacity-40"
                          >
                            <StarIcon className="h-4 w-4 fill-amber-400 text-amber-500" />
                          </button>
                        </div>
                      );
                    })}
                </>
              ) : activeTab === "recent" ? (
                <>
                  {recentLoading && (
                    <div className="col-span-3 py-8 text-center text-sm text-gray-500">Loading recent…</div>
                  )}
                  {!recentLoading && recentError && (
                    <div className="col-span-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {recentError}
                      <p className="mt-1 text-xs text-amber-800/90">
                        Ensure table <code className="rounded bg-white/80 px-1">medication_history</code> exists (see{" "}
                        <code className="rounded bg-white/80 px-1">app/lib/medicationWorkspace.ts</code>).
                      </p>
                    </div>
                  )}
                  {!recentLoading && !recentError && filteredRecent.length === 0 && (
                    <div className="col-span-3 py-8 text-center text-sm text-gray-400">
                      No recent prescriptions yet. Finalize a prescription to build this list.
                    </div>
                  )}
                  {!recentLoading &&
                    !recentError &&
                    filteredRecent.map((row) => {
                      const cat = catalogEntryFromHistoryRow(row);
                      const sig = [row.dosage_text, row.frequency, row.duration].filter(Boolean).join(" · ");
                      const fav = findFavoriteRow(cat) !== undefined;
                      return (
                        <div
                          key={row.id}
                          className="relative rounded-xl border border-slate-200 bg-slate-50/60 transition hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
                        >
                          <button
                            type="button"
                            onClick={() => beginFromRecentHistory(row)}
                            className="flex w-full flex-col gap-1 p-3 pr-10 text-left focus:outline-none focus:ring-2 focus:ring-slate-400"
                          >
                            <p className="text-xs font-semibold leading-tight text-gray-900">{row.medicine_name}</p>
                            {sig ? <p className="text-[11px] text-gray-500">{sig}</p> : null}
                            <p className="text-[10px] text-slate-600">Tap to reuse (dosage pre-filled)</p>
                          </button>
                          <button
                            type="button"
                            disabled={favoriteBusyKey === medFavoriteBusyKey(cat)}
                            aria-label={fav ? "Remove from favorites" : "Add to favorites"}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void handleToggleFavoriteMed(cat);
                            }}
                            className="absolute right-1.5 top-1.5 rounded-lg p-1.5 text-gray-400 transition hover:bg-white/80 hover:text-amber-500 disabled:opacity-40"
                          >
                            <StarIcon
                              className={`h-4 w-4 ${fav ? "fill-amber-400 text-amber-500" : "text-gray-300"}`}
                            />
                          </button>
                        </div>
                      );
                    })}
                </>
              ) : (
                <>
                  {registryLoading && (
                    <div className="col-span-3 py-8 text-center text-sm text-gray-500">
                      Searching registry &amp; formulary…
                    </div>
                  )}
                  {!registryLoading && hospitalSearchHint && (
                    <div className="col-span-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-center text-sm text-gray-600">
                      {hospitalSearchHint}
                    </div>
                  )}
                  {!registryLoading &&
                    !hospitalSearchHint &&
                    searchQuery.trim().length < 2 && (
                      <div className="col-span-3 py-8 text-center text-sm text-gray-400">
                        Type at least 2 characters to search the medication registry and your in-house formulary.
                      </div>
                    )}
                  {!registryLoading &&
                    !hospitalSearchHint &&
                    searchQuery.trim().length >= 2 &&
                    registryRows.length === 0 && (
                      <div className="col-span-3 py-8 text-center text-sm text-gray-400">
                        No matches for that name. Try another spelling, type a custom medicine, or use a clinical proposal below.
                      </div>
                    )}
                  {!registryLoading &&
                    registryRows.map((med) => (
                      <MedicineCard
                        key={med.id}
                        med={med}
                        onAdd={pickMedicationFromFormularySearch}
                        isFavorite={findFavoriteRow(med) !== undefined}
                        onToggleFavorite={handleToggleFavoriteMed}
                        favoriteBusy={favoriteBusyKey === medFavoriteBusyKey(med)}
                      />
                    ))}
                </>
              )}
            </div>

            {/* Current prescription list — inline entry (no dosage modal) */}
            <div className="mt-6 border-t border-gray-100 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900">Current Prescription</h3>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${addedMedicines.length > 0 ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-400"}`}>
                  {addedMedicines.length} medicine{addedMedicines.length !== 1 ? "s" : ""}
                </span>
              </div>

              {inlineDraft?.isNew ? (
                <div ref={newComposeContainerRef} className="relative z-40 mb-3 w-full">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <p className="text-xs font-bold text-gray-900">
                      {inlineDraft.variant === "manual" ? (
                        <span className="block w-full max-w-md">
                          <label className="sr-only" htmlFor="rx-inline-manual-name">
                            Medicine name
                          </label>
                          <input
                            ref={manualNameRef}
                            id="rx-inline-manual-name"
                            value={manualMedicineName}
                            onChange={(e) => setManualMedicineName(e.target.value)}
                            placeholder="Medicine name"
                            className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100"
                            autoComplete="off"
                          />
                        </span>
                      ) : (
                        formatAbdmMedicationLabel(inlineDraft.line.catalog)
                      )}
                    </p>
                  </div>
                  <InlineDosageSelector
                    key={inlineDraft.line.id}
                    line={inlineDraft.line}
                    isNew
                    outsideDismissBoundsRef={newComposeContainerRef}
                    catalogStock={availableStockBeforeLine(inlineDraft.line, addedMedicines)}
                    onConfirm={(partial) => {
                      if (inlineDraft.variant === "manual" && !manualMedicineName.trim()) return;
                      handleInlineDosageConfirm(partial);
                    }}
                    onCancel={cancelInlineDraft}
                  />
                  {inlineDraft.variant === "manual" && !manualMedicineName.trim() ? (
                    <p className="mt-1 text-[10px] text-amber-700">Enter a medicine name to enable Add.</p>
                  ) : null}
                </div>
              ) : null}

              {addedMedicines.length === 0 && !inlineDraft ? (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-8 text-center">
                  <PillIcon className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-1.5 text-xs text-gray-400">
                    Pick a medicine from search, favorites, or recent — set frequency &amp; duration inline, then Add. Search refocuses for the next drug.
                  </p>
                </div>
              ) : addedMedicines.length > 0 ? (
                <div className="flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-gray-50/80 p-3">
                  {addedMedicines.map((line) => (
                    <div
                      key={line.id}
                      ref={(el) => {
                        chipAnchorRefs.current[line.id] = el;
                      }}
                      className="relative inline-block"
                    >
                      <PrescriptionChip
                        line={line}
                        onEdit={startInlineEdit}
                        onRemove={handleRemoveLine}
                        isFavorite={findFavoriteRow(line.catalog) !== undefined}
                        favoriteBusy={favoriteBusyKey === medFavoriteBusyKey(line.catalog)}
                        onToggleFavorite={() => void handleToggleFavoriteMed(line.catalog)}
                        flash={flashLineId === line.id}
                        allowPrescribeEdits={rxEdit}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-6 border-t border-gray-100 pt-4">
              <h3 className="mb-1 text-sm font-bold text-gray-900">Attach lab reports</h3>
              <p className="mb-3 text-[11px] text-gray-500">
                Completed OCR reports for this visit. Included summaries appear after medications on print
                {whatsappNotificationsEnabled ? " and optionally on WhatsApp" : ""}.
              </p>
              {labAttachLoading ? (
                <p className="text-xs text-gray-400">Loading lab reports…</p>
              ) : labAttachError ? (
                <p className="text-xs text-amber-700">{labAttachError}</p>
              ) : labAttachSlots.length === 0 ? (
                <p className="text-xs text-gray-400">No completed lab OCR for this encounter.</p>
              ) : (
                <ul className="space-y-3">
                  {labAttachSlots.map((slot) => (
                    <li
                      key={slot.ocr_upload_id}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs shadow-sm"
                    >
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          checked={slot.checked}
                          disabled={!rxEdit}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setLabAttachSlots((prev) =>
                              prev.map((s) => (s.ocr_upload_id === slot.ocr_upload_id ? { ...s, checked: v } : s)),
                            );
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-gray-300"
                        />
                        <span className="font-semibold text-gray-800">
                          {slot.display_name} — {slot.report_date_label}
                        </span>
                      </label>
                      {slot.checked ? (
                        <div className="mt-2 flex flex-wrap gap-4 border-t border-gray-100 pt-2 pl-6 text-[11px] text-gray-600">
                          {whatsappNotificationsEnabled ? (
                            <label className="flex cursor-pointer items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={slot.includeWhatsapp}
                                disabled={!rxEdit}
                                onChange={(e) => {
                                  const v = e.target.checked;
                                  setLabAttachSlots((prev) =>
                                    prev.map((s) =>
                                      s.ocr_upload_id === slot.ocr_upload_id ? { ...s, includeWhatsapp: v } : s,
                                    ),
                                  );
                                }}
                                className="h-3.5 w-3.5 rounded border-gray-300"
                              />
                              Include in WhatsApp
                            </label>
                          ) : null}
                          <label className="flex cursor-pointer items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={slot.includePrint}
                              disabled={!rxEdit}
                              onChange={(e) => {
                                const v = e.target.checked;
                                setLabAttachSlots((prev) =>
                                  prev.map((s) =>
                                    s.ocr_upload_id === slot.ocr_upload_id ? { ...s, includePrint: v } : s,
                                  ),
                                );
                              }}
                              className="h-3.5 w-3.5 rounded border-gray-300"
                            />
                            Include in print
                          </label>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </div>
            </PermissionSurface>
          </div>

          {/* ─── Right: Prescription preview ─── */}
          <div className="flex flex-col gap-4 overflow-y-auto bg-slate-100 p-5">
            <h3 className="text-sm font-bold text-gray-700">Prescription Preview</h3>

            {/* Paper — ref targets this for print */}
            <div
              ref={printRef}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-[12px] leading-relaxed text-gray-800 print:m-0 print:h-screen print:max-w-none print:rounded-none print:border-none print:p-8 print:shadow-none print:w-full"
              style={{ WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
            >

              {/* Incomplete profile warning */}
              {profileIncomplete && (
                <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-700 print:hidden">
                  <span className="font-bold">⚠ Incomplete Profile:</span>
                  &nbsp;Update your Reg. No. in Settings to print.
                </div>
              )}

              {/* Hospital header */}
              <div className="flex items-start justify-between border-b border-gray-200 pb-3">
                <div className="flex items-start gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 print:h-10 print:w-10">
                    <PillIcon className="h-4 w-4 text-blue-600 print:h-5 print:w-5" />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 print:text-base">{clinicDisplayName}</p>
                    <p className="text-[11px] text-gray-500 print:text-sm">DocPad Digital Health Network</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900 print:text-base">{doctorTitle}</p>
                  <p className="text-[11px] text-gray-500 print:text-sm">
                    {doctorQualification}{doctorSpecialty ? ` · ${doctorSpecialty}` : ""}
                  </p>
                  <p className={`text-[11px] print:text-sm ${doctorRegNo ? "text-gray-500" : "text-red-400 italic"}`}>
                    {doctorRegNo ? `Reg. No.: ${doctorRegNo}` : "Reg. No.: Not set"}
                  </p>
                </div>
              </div>

              {/* Patient row */}
              <div className="mt-2 flex items-center justify-between border-b border-gray-100 pb-2">
                <p className="font-semibold text-gray-800 print:text-sm">
                  {patientName}{patientAge != null ? `, ${patientAge}Y` : ""}{patientSex ? ` / ${patientSex.charAt(0).toUpperCase()}` : ""}
                  <span className="ml-2 text-[11px] font-normal text-gray-400">ID: {patientDisplayId}</span>
                </p>
                <p className="text-gray-500 print:text-sm">Date: {todayStr}</p>
              </div>

              {/* Rx body */}
              <div className="mt-3 flex gap-3">
                <div className="w-[42%] border-r border-gray-100 pr-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 print:text-xs">Clinical Summary</p>

                  {/* Allergies — always show, "Nil known" when empty */}
                  <div className={`rounded px-2 py-1 ${allergies.length > 0 ? "bg-red-50" : "bg-gray-50"}`}>
                    <span className={`text-[10px] font-bold print:text-xs ${allergies.length > 0 ? "text-red-600" : "text-gray-400"}`}>
                      {allergies.length > 0 ? "⚠ Allergies: " : "Allergies: "}
                    </span>
                    <span className={`text-[11px] print:text-sm ${allergies.length > 0 ? "text-red-700" : "italic text-gray-400"}`}>
                      {allergies.length > 0
                        ? allergies.map((a) => toDisplay(a)).filter(Boolean).join(", ")
                        : "No known allergies"}
                    </span>
                  </div>

                  {/* Chief complaints */}
                  <div>
                    <span className="text-[10px] font-bold text-gray-500 print:text-xs">C/O: </span>
                    <span className="text-[11px] text-gray-700 print:text-sm">
                      {chiefComplaints.length > 0
                        ? chiefComplaints.map((c) => toDisplay(c)).filter(Boolean).join(", ")
                        : <span className="italic text-gray-400">Nil</span>}
                    </span>
                  </div>

                  {/* On Examination */}
                  <div>
                    <span className="text-[10px] font-bold text-gray-500 print:text-xs">O/E: </span>
                    <span className="text-[11px] text-gray-700 print:text-sm">
                      {quickExam?.trim()
                        ? quickExam
                        : <span className="italic text-gray-400">Nil</span>}
                    </span>
                  </div>

                  {/* Vitals — tight grid for A4 */}
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 print:text-xs">Vitals:</p>
                    {Object.values(vitals).some((v) => v?.trim()) ? (
                      <table className="mt-0.5 w-full text-[10px] text-gray-700 print:text-xs">
                        <tbody>
                          {vitals.weight        && <tr><td className="pr-1 text-gray-400">Wt</td><td>{vitals.weight} kg</td></tr>}
                          {vitals.bloodPressure && <tr><td className="pr-1 text-gray-400">BP</td><td>{vitals.bloodPressure} mmHg</td></tr>}
                          {vitals.pulse         && <tr><td className="pr-1 text-gray-400">PR</td><td>{vitals.pulse} bpm</td></tr>}
                          {vitals.temperature   && <tr><td className="pr-1 text-gray-400">Temp</td><td>{vitals.temperature}°C</td></tr>}
                          {vitals.spo2          && <tr><td className="pr-1 text-gray-400">SpO₂</td><td>{vitals.spo2}%</td></tr>}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-[11px] italic text-gray-400 print:text-sm">Not recorded</p>
                    )}
                  </div>

                  {/* Diagnosis with optional ICD-10 */}
                  <div>
                    <span className="text-[10px] font-bold text-gray-500 print:text-xs">Dx: </span>
                    <span className="text-[11px] text-gray-700 print:text-sm">
                      {diagnosis && toDisplay(diagnosis).trim()
                        ? <>
                            {toDisplay(diagnosis)}
                            {toIcd10(diagnosis) && (
                              <span className="ml-1 text-gray-400">({toIcd10(diagnosis)})</span>
                            )}
                          </>
                        : <span className="italic text-gray-400">Nil</span>}
                    </span>
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 print:text-xs">Medication &amp; Advice</p>
                  {addedMedicines.length === 0 ? (
                    <>
                      <p className="mt-1 font-serif text-2xl font-bold italic text-blue-700">Rx</p>
                      <p className="mt-1 text-[11px] italic text-gray-400 print:text-sm">Medications will appear here</p>
                    </>
                  ) : (
                    <ul className="mt-1.5 space-y-2.5">
                      {addedMedicines.map((m, i) => {
                        const sig = [m.dosage, m.frequency, m.duration].filter(Boolean).join(" · ");
                        const extra =
                          m.timing || m.instructions
                            ? [m.timing, m.instructions].filter(Boolean).join(". ")
                            : "";
                        return (
                          <li key={m.id} className="text-[11px] print:text-sm">
                            <p className="font-semibold text-gray-800">
                              {i + 1}. {formatAbdmMedicationLabel(m.catalog)}
                            </p>
                            {sig ? <p className="text-gray-600">{sig}</p> : null}
                            {extra ? <p className="italic text-gray-500">{extra}</p> : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {labSummaryItemsForPrint().length > 0 ? (
                    <div className="mt-3 border-t border-gray-100 pt-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 print:text-xs">
                        Attached lab summaries
                      </p>
                      <div className="mt-1.5 space-y-3">
                        {labSummaryItemsForPrint().map((block) => (
                          <div key={block.displayName}>
                            <p className="text-[11px] font-semibold text-gray-800 print:text-sm">{block.displayName}</p>
                            <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-[10px] text-gray-700 print:text-xs">
                              {block.entries.map((e, idx) => {
                                const name = (e.parameter_name ?? "").trim() || "—";
                                const val =
                                  e.value_text?.trim() ||
                                  (e.value_numeric != null && Number.isFinite(e.value_numeric)
                                    ? String(e.value_numeric)
                                    : "");
                                const u = (e.unit ?? "").trim();
                                const ref = (e.ref_range_text ?? "").trim();
                                const valuePart = [val, u].filter(Boolean).join(" ");
                                const line = valuePart
                                  ? `${name}: ${valuePart}${ref ? ` (Ref: ${ref})` : ""}`
                                  : `${name}${ref ? ` (Ref: ${ref})` : ""}`;
                                return (
                                  <li key={`${name}-${idx}`}>{line}</li>
                                );
                              })}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Procedures */}
                  {procedures.length > 0 && (
                    <div className="mt-3 border-t border-gray-100 pt-2">
                      <p className="text-[10px] font-bold text-gray-500 print:text-xs">Procedures:</p>
                      <ul className="mt-1 list-inside list-disc space-y-0.5">
                        {procedures.map((p, i) => {
                          const label  = toDisplay(p);
                          const icd10  = toIcd10(p);
                          return label ? (
                            <li key={i} className="text-[11px] text-gray-700 print:text-sm">
                              {label}
                              {icd10 && <span className="ml-1 text-gray-400">({icd10})</span>}
                            </li>
                          ) : null;
                        })}
                      </ul>
                    </div>
                  )}

                  {advice?.trim() ? (
                    <div className="mt-3 border-t border-gray-100 pt-2">
                      <p className="text-[10px] font-bold text-gray-500 print:text-xs">Advice:</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-gray-700 print:text-sm">{advice}</p>
                    </div>
                  ) : null}
                </div>

              </div>

              {/* Follow-up */}
              {followUpDate?.trim() ? (
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <p className="text-[11px] text-gray-700 print:text-sm">
                    <span className="font-semibold text-gray-800">Follow-up: </span>
                    {formatFollowUpForPrint(followUpDate.trim())}
                  </p>
                </div>
              ) : null}

              {/* QR + signature */}
              <div className="mt-3 flex items-end justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded border border-gray-200 bg-gray-50 text-[9px] font-medium text-gray-400 text-center leading-tight p-1 print:h-16 print:w-16 print:text-[11px]">
                  Scan for Digital Dashboard &amp; reminders
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-bold text-gray-800 print:text-sm">{doctorTitle}</p>
                  <p className="text-[10px] text-gray-400 print:text-xs">
                    {doctorQualification}{doctorSpecialty ? ` · ${doctorSpecialty}` : ""}
                  </p>
                  {doctorRegNo && (
                    <p className="text-[10px] text-gray-400 print:text-xs">Reg. {doctorRegNo}</p>
                  )}
                </div>
              </div>

              <p className="mt-3 text-center text-[10px] text-gray-400 print:text-xs">
                This is a digitally generated prescription via DocPad
                <br />This prescription complies with EPS data requirements.
              </p>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="border-t border-gray-200 bg-white px-6 py-3">
          {/* Error banner */}
          {saveError && (
            <p role="alert" className="mb-2 text-center text-xs font-medium text-red-600">{saveError}</p>
          )}
          {templateToast && (
            <div
              role="status"
              className="mb-2 flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 py-1.5 text-xs font-semibold text-emerald-800"
            >
              {templateToast}
            </div>
          )}
          {/* WhatsApp success toast */}
          {whatsappNotificationsEnabled && whatsAppSuccess && (
            <div
              role="status"
              className="mb-2 flex items-center justify-center gap-2 rounded-lg bg-green-50 py-1.5 text-xs font-semibold text-green-700"
            >
              <WhatsAppIcon className="h-3.5 w-3.5" />
              Prescription sent to {patientName} on WhatsApp!
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Left options */}
            <div className="flex items-center gap-4">
              {rxEdit ? (
                <>
                  <button
                    type="button"
                    onClick={() => setSaveTemplateModalOpen(true)}
                    disabled={
                      addedMedicines.length === 0 ||
                      isSaving ||
                      (whatsappNotificationsEnabled && isSendingWhatsApp) ||
                      Boolean(inlineDraft)
                    }
                    className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <StarIcon className="h-3.5 w-3.5" /> Save as template
                  </button>
                  <span className="text-gray-300">|</span>
                </>
              ) : null}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-gray-500">Rx Lang:</span>
                <select className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:border-blue-400">
                  <option>English + Hindi (हिंदी)</option>
                  <option>English only</option>
                </select>
              </div>
            </div>

            {/* Right buttons */}
            {rxEdit ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
                >
                  <ClockIcon className="h-4 w-4" /> Save Draft
                </button>
                <button
                  type="button"
                  onClick={handleSavePrescription}
                  disabled={
                    isSaving || (whatsappNotificationsEnabled && isSendingWhatsApp) || addedMedicines.length === 0 || Boolean(inlineDraft)
                  }
                  className="flex items-center gap-1.5 rounded-xl border border-gray-300 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PharmacyIcon className="h-4 w-4" />
                  {isSaving ? "Saving…" : "Route to Pharmacy"}
                </button>
                <button
                  type="button"
                  onClick={handleSavePrescription}
                  disabled={
                    isSaving || (whatsappNotificationsEnabled && isSendingWhatsApp) || addedMedicines.length === 0 || Boolean(inlineDraft)
                  }
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PrinterIcon className="h-4 w-4" />
                  {isSaving ? "Saving…" : "Finalize Prescription"}
                </button>
                {whatsappNotificationsEnabled ? (
                  <button
                    type="button"
                    onClick={handleWhatsAppSend}
                    disabled={
                      isSaving ||
                      isSendingWhatsApp ||
                      addedMedicines.length === 0 ||
                      !patientPhone ||
                      Boolean(inlineDraft)
                    }
                    title={!patientPhone ? "No phone number on file" : "Send prescription via WhatsApp"}
                    className="flex items-center gap-1.5 rounded-xl bg-[#25D366] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1ebe5d] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSendingWhatsApp ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                          <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                          <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                        </svg>
                        Sending…
                      </>
                    ) : (
                      <>
                        <WhatsAppIcon className="h-4 w-4" />
                        Send to WhatsApp
                      </>
                    )}
                  </button>
                ) : null}
              </div>
            ) : dispEdit ? (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
                  <span>Dispensing status</span>
                  <select
                    value={dispensingEncounterStatus}
                    onChange={(e) =>
                      setDispensingEncounterStatus(e.target.value as "pending" | "prepared" | "dispensed")
                    }
                    className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 outline-none focus:border-blue-400"
                  >
                    <option value="pending">Pending</option>
                    <option value="prepared">Prepared</option>
                    <option value="dispensed">Dispensed</option>
                  </select>
                </label>
                <span className="text-[11px] text-gray-400" title="Persisted dispensing workflow will connect to pharmacy records.">
                  🔒 Pharmacist edit
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {inlineDraft && !inlineDraft.isNew && dosagePopoverPos ? (
          <div
            ref={dosagePopoverRef}
            className="pointer-events-auto absolute z-[60] min-w-[420px] max-w-[560px]"
            style={{ top: dosagePopoverPos.top, left: dosagePopoverPos.left }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <InlineDosageSelector
              key={inlineDraft.line.id}
              line={inlineDraft.line}
              isNew={false}
              catalogStock={availableStockBeforeLine(inlineDraft.line, addedMedicines)}
              isTargetInsideProtectedTargets={isDosageEditProtectedTarget}
              onConfirm={handleInlineDosageConfirm}
              onCancel={cancelInlineDraft}
            />
          </div>
        ) : null}

      </div>
    </div>

    <ClinicalProposalModal
      open={clinicalProposalOpen}
      onClose={() => {
        if (!proposalSubmitting) {
          setClinicalProposalOpen(false);
          setProposalError(null);
        }
      }}
      submitting={proposalSubmitting}
      errorMessage={proposalError}
      onSubmit={(p) => void handleClinicalProposalSubmit(p)}
    />

    <SaveTemplateModal
      open={saveTemplateModalOpen}
      onClose={() => setSaveTemplateModalOpen(false)}
      currentPrescription={addedMedicines}
      onSaved={(templateName) => {
        setTemplateToast(`Template “${templateName}” saved.`);
        setTemplatesRefreshKey((k) => k + 1);
      }}
    />
    </>
  );
}
