"use client";

import { memo, useCallback, type CSSProperties, type MouseEvent, type ReactElement } from "react";
import type { RowComponentProps } from "react-window";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type OpdTemplateListRow = {
  id: string;
  name: string;
  template_type: string;
  department_id: string;
  department_name: string;
  is_default: boolean;
  is_active: boolean;
};

export type OpdTemplateRowHandlers = {
  busyId: string | null;
  onRowClick: (id: string) => void;
  onToggleActive: (id: string, next: boolean) => void;
  onToggleDefault: (id: string, next: boolean) => void;
};

/** Shared column template for list header + rows */
export const OPD_TEMPLATE_LIST_GRID =
  "grid w-full min-w-[720px] grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,1.6fr)] items-center gap-2 px-3 py-2.5 text-sm";

type InnerProps = {
  row: OpdTemplateListRow;
  handlers: OpdTemplateRowHandlers;
  className?: string;
  style?: CSSProperties;
};

export const OpdTemplateTableRowInner = memo(function OpdTemplateTableRowInner({
  row,
  handlers,
  className,
  style,
}: InnerProps) {
  const { busyId, onRowClick, onToggleActive, onToggleDefault } = handlers;
  const busy = busyId === row.id;

  const rowClick = useCallback(() => {
    onRowClick(row.id);
  }, [onRowClick, row.id]);

  const stop = useCallback((e: MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      role="row"
      className={cn(
        OPD_TEMPLATE_LIST_GRID,
        "cursor-pointer border-b border-border transition-colors hover:bg-muted/50",
        className,
      )}
      style={style}
      onClick={rowClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          rowClick();
        }
      }}
      tabIndex={0}
    >
      <div className="min-w-0 font-medium text-foreground">
        <span className="line-clamp-2">{row.name}</span>
      </div>
      <div className="text-muted-foreground capitalize">{row.template_type.replace(/_/g, " ")}</div>
      <div className="truncate text-muted-foreground" title={row.department_name}>
        {row.department_name}
      </div>
      <div onClick={stop}>
        {row.is_default ? (
          <span className="inline-flex rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
            Default
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
      <div onClick={stop}>
        {row.is_active ? (
          <span className="inline-flex rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-semibold text-green-600 dark:bg-green-500/20 dark:text-green-400">
            Active
          </span>
        ) : (
          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground ring-1 ring-border">
            Off
          </span>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-1.5" onClick={stop}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={busy}
          onClick={() => onToggleActive(row.id, !row.is_active)}
        >
          {row.is_active ? "Deactivate" : "Activate"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={busy || row.is_default}
          onClick={() => onToggleDefault(row.id, true)}
        >
          Set default
        </Button>
        {row.is_default ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={busy}
            onClick={() => onToggleDefault(row.id, false)}
          >
            Clear default
          </Button>
        ) : null}
      </div>
    </div>
  );
});

export type VirtualRowData = {
  rows: OpdTemplateListRow[];
  handlers: OpdTemplateRowHandlers;
};

/** Virtualized row wrapper for `react-window` (style positions the row). */
/** Not wrapped in `memo` so `react-window` v2 `rowComponent` typing accepts a strict `ReactElement | null` return. */
export function OpdTemplateVirtualRow(props: RowComponentProps<VirtualRowData>): ReactElement | null {
  const { index, style, ariaAttributes, rows, handlers } = props;
  const row = rows[index];
  if (!row) return null;
  return (
    <div {...ariaAttributes} style={style}>
      <OpdTemplateTableRowInner row={row} handlers={handlers} />
    </div>
  );
}
