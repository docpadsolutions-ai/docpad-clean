"use client";

import type { HealthTimelineNode } from "../lib/fhirEncounterTimeline";

const DOT: Record<HealthTimelineNode["_kind"], { fill: string; ring: string }> = {
  opd: { fill: "#2563eb", ring: "#93c5fd" },
  ipd: { fill: "#9333ea", ring: "#d8b4fe" },
  surgery: { fill: "#dc2626", ring: "#fecaca" },
  emergency: { fill: "#ea580c", ring: "#fdba74" },
};

function formatShortDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "2-digit" });
}

export default function HealthTimeline({
  nodes,
  onLiveOpdClick,
}: {
  nodes: HealthTimelineNode[];
  onLiveOpdClick?: (opdEncounterId: string) => void;
}) {
  const slotW = 128;
  const height = 120;
  const padX = 24;
  const lineY = 78;
  const dotR = 8;
  const w = Math.max(320, nodes.length * slotW + padX * 2);

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-gray-900">Health timeline</h2>
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-medium text-gray-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> OPD
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-purple-600" /> IPD
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-600" /> Surgery
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-orange-600" /> Emergency
          </span>
        </div>
      </div>

      <div className="relative overflow-x-auto rounded-xl border border-gray-200 bg-gradient-to-b from-slate-50 to-white pb-2 pt-1 shadow-inner">
        <svg
          width={w}
          height={height}
          className="min-w-full shrink-0"
          role="img"
          aria-label="Patient health timeline"
        >
          <defs>
            <linearGradient id="health-tl-line" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#cbd5e1" />
              <stop offset="100%" stopColor="#94a3b8" />
            </linearGradient>
          </defs>
          <line
            x1={padX}
            y1={lineY}
            x2={w - padX}
            y2={lineY}
            stroke="url(#health-tl-line)"
            strokeWidth={3}
            strokeLinecap="round"
          />
          {nodes.map((node, i) => {
            const cx = padX + slotW * i + slotW / 2;
            const colors = DOT[node._kind];
            const isLive = node._source === "live" && node._opdEncounterId;
            return (
              <g key={node.id}>
                <title>
                  {node._displayLabel} — {node.class.display} — {node.period.start ?? ""}
                </title>
                <text
                  x={cx}
                  y={28}
                  textAnchor="middle"
                  className="fill-gray-800"
                  style={{ fontSize: 11, fontWeight: 600 }}
                >
                  {node._displayLabel.length > 22
                    ? `${node._displayLabel.slice(0, 20)}…`
                    : node._displayLabel}
                </text>
                <text
                  x={cx}
                  y={44}
                  textAnchor="middle"
                  className="fill-gray-400"
                  style={{ fontSize: 9 }}
                >
                  {formatShortDate(node.period.start)}
                </text>
                <circle
                  cx={cx}
                  cy={lineY}
                  r={dotR + 3}
                  fill="white"
                  stroke={colors.ring}
                  strokeWidth={2}
                  className={isLive ? "cursor-pointer transition hover:opacity-90" : ""}
                  onClick={() => {
                    if (isLive && node._opdEncounterId && onLiveOpdClick) {
                      onLiveOpdClick(node._opdEncounterId);
                    }
                  }}
                />
                <circle
                  cx={cx}
                  cy={lineY}
                  r={dotR}
                  fill={colors.fill}
                  className={isLive ? "cursor-pointer" : ""}
                  onClick={() => {
                    if (isLive && node._opdEncounterId && onLiveOpdClick) {
                      onLiveOpdClick(node._opdEncounterId);
                    }
                  }}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
