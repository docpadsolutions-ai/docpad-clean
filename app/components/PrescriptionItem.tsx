"use client";

import { formatAbdmMedicationLabel } from "../lib/medicineCatalog";
import type { PrescriptionLine } from "../lib/prescriptionLine";

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type PrescriptionItemProps = {
  line: PrescriptionLine;
  onEdit: (line: PrescriptionLine) => void;
  onRemove: (id: string) => void;
  isFavorite?: boolean;
  favoriting?: boolean;
  onToggleFavorite?: () => void;
};

export default function PrescriptionItem({
  line,
  onEdit,
  onRemove,
  isFavorite,
  favoriting,
  onToggleFavorite,
}: PrescriptionItemProps) {
  const metaParts = [line.dosage, line.frequency, line.duration].filter((s) => s?.trim());
  const meta = metaParts.join(" · ");

  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-gray-900">{line.catalog.displayName}</p>
        {line.catalog.medication_source === "stock" ? (
          <p className="mt-1">
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                line.catalog.stock > 0 ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
              }`}
            >
              IN-HOUSE: {line.catalog.stock}
            </span>
          </p>
        ) : null}
        {meta ? <p className="mt-0.5 text-[11px] text-gray-600">{meta}</p> : null}
        {(line.timing || line.instructions) && (
          <p className="mt-0.5 text-[11px] text-gray-500">
            {line.timing ? <span className="font-medium text-gray-600">{line.timing}</span> : null}
            {line.timing && line.instructions ? " · " : null}
            {line.instructions ? <span className="italic">{line.instructions}</span> : null}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {onToggleFavorite && (
          <button
            type="button"
            disabled={favoriting}
            onClick={onToggleFavorite}
            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-amber-50 hover:text-amber-600 disabled:opacity-40"
          >
            <StarIcon
              className={`h-3.5 w-3.5 ${isFavorite ? "fill-amber-400 text-amber-500" : "text-gray-300"}`}
            />
          </button>
        )}
        <button
          type="button"
          onClick={() => onEdit(line)}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600"
          aria-label={`Edit ${formatAbdmMedicationLabel(line.catalog)}`}
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(line.id)}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
          aria-label="Remove"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}
