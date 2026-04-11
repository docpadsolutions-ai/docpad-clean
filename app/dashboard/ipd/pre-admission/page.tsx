import { Suspense } from "react";
import PreAdmissionAssessmentPage from "@/app/components/ipd/PreAdmissionAssessmentPage";

export default function IpdPreAdmissionRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <PreAdmissionAssessmentPage />
    </Suspense>
  );
}
