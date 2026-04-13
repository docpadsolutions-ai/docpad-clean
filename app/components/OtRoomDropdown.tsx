"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/app/supabase";
import { cn } from "@/lib/utils";

export type OtRoomRow = {
  id: string;
  name: string;
  ot_number: string;
  specialty: string | null;
};

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export function formatOtRoomOptionLabel(row: Pick<OtRoomRow, "ot_number" | "name" | "specialty">): string {
  const sp = row.specialty != null && s(row.specialty) !== "" ? s(row.specialty) : "";
  const base = `${row.ot_number} · ${row.name}`;
  return sp ? `${base} (${sp})` : base;
}

function parseOtRoom(r: Record<string, unknown>): OtRoomRow | null {
  const id = s(r.id);
  const ot_number = s(r.ot_number);
  const name = s(r.name);
  if (!id || !ot_number || !name) return null;
  return {
    id,
    ot_number,
    name,
    specialty: r.specialty != null && s(r.specialty) !== "" ? s(r.specialty) : null,
  };
}

type Props = {
  hospitalId: string;
  value: string;
  onChange: (otNumber: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-labelledby"?: string;
};

export default function OtRoomDropdown({
  hospitalId,
  value,
  onChange,
  disabled,
  className,
  "aria-labelledby": ariaLabelledBy,
}: Props) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<OtRoomRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const hid = hospitalId?.trim();
    if (!hid) {
      setRooms([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("ot_rooms")
      .select("id, name, ot_number, specialty")
      .eq("hospital_id", hid)
      .eq("is_active", true)
      .order("ot_number");
    setLoading(false);
    if (error) {
      console.warn("[OtRoomDropdown]", error.message);
      setRooms([]);
      return;
    }
    setRooms(((data ?? []) as Record<string, unknown>[]).map(parseOtRoom).filter(Boolean) as OtRoomRow[]);
  }, [hospitalId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = rooms.find((r) => r.ot_number === value.trim());
  const buttonLabel = selected
    ? formatOtRoomOptionLabel(selected)
    : value.trim()
      ? value.trim()
      : loading
        ? "Loading…"
        : "Select OT…";

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={ariaLabelledBy}
        onClick={() => !disabled && !loading && setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-900 shadow-sm outline-none transition",
          "hover:border-gray-400 focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-1",
          (disabled || loading) && "cursor-not-allowed opacity-60",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{buttonLabel}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-gray-500 transition", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
          style={{ top: "100%" }}
        >
          {rooms.length === 0 ? (
            <li
              role="option"
              aria-disabled
              className="cursor-not-allowed px-3 py-2.5 text-sm text-gray-500"
            >
              No OTs configured — add in Admin
            </li>
          ) : (
            rooms.map((r) => {
              const label = formatOtRoomOptionLabel(r);
              const isSel = r.ot_number === value.trim();
              return (
                <li key={r.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    className={cn(
                      "w-full px-3 py-2.5 text-left text-sm text-gray-900 hover:bg-gray-100",
                      isSel && "bg-blue-50 font-medium text-blue-900",
                    )}
                    onClick={() => {
                      onChange(r.ot_number);
                      setOpen(false);
                    }}
                  >
                    {label}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
