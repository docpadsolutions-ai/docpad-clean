"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { PreauthForm } from "../../PreauthForm";

function EditPreauthInner() {
  const params = useParams();
  const id = String(params.id ?? "").trim();
  if (!id) {
    return (
      <div className="p-6 text-slate-700 dark:text-slate-300">
        <p>Missing preauthorization id.</p>
      </div>
    );
  }
  return (
    <PreauthForm
      variant="edit"
      preauthId={id}
      title="Edit preauthorization"
      description="Save your draft or submit when ready. Submitted preauths open as read-only from View."
    />
  );
}

export default function EditPreauthPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center bg-slate-50 p-6 dark:bg-gray-950 dark:text-gray-300">
          Loading…
        </div>
      }
    >
      <EditPreauthInner />
    </Suspense>
  );
}
