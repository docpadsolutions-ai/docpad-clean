"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";

export type DrugRow = {
  id: string;
  generic_name: string;
  brand_name: string;
  form: string | null;
  strength: string | null;
  mrp: number | null;
  min_stock: number;
  is_active: boolean;
};

function formatMrp(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
  } catch {
    return `₹${n}`;
  }
}

export const DrugTableRow = memo(function DrugTableRow({
  drug,
  readOnly = false,
}: {
  drug: DrugRow;
  readOnly?: boolean;
}) {
  return (
    <TableRow className="border-border">
      <TableCell className="max-w-[10rem] font-medium text-foreground">
        <span className="line-clamp-2">{drug.generic_name}</span>
      </TableCell>
      <TableCell className="max-w-[9rem] text-muted-foreground">
        <span className="line-clamp-2">{drug.brand_name}</span>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{drug.form ?? "—"}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{drug.strength ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap text-sm tabular-nums">{formatMrp(drug.mrp)}</TableCell>
      <TableCell className="text-sm tabular-nums">{drug.min_stock}</TableCell>
      <TableCell>
        {drug.is_active ? (
          <span className="inline-flex rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-semibold text-green-600 dark:bg-green-500/20 dark:text-green-400">
            Active
          </span>
        ) : (
          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground ring-1 ring-border">
            Inactive
          </span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {readOnly ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" size="sm" disabled title="Coming soon">
              Edit
            </Button>
            <Button type="button" variant="outline" size="sm" disabled title="Coming soon">
              Deactivate
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
});
