"use client";

import { Suspense } from "react";
import { PreauthForm } from "../PreauthForm";

export default function NewPreauthPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center bg-slate-50 p-6 dark:bg-gray-950 dark:text-gray-300">
          Loading…
        </div>
      }
    >
      <PreauthForm
        variant="create"
        title="New preauthorization"
        description="Build the request, save a draft, then submit to the payer."
      />
    </Suspense>
  );
}
