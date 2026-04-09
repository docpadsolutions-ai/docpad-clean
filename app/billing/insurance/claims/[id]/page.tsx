"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ClaimForm } from "../ClaimForm";
import { Button } from "@/components/ui/button";

export default function ViewClaimPage() {
  const params = useParams();
  const id = String(params.id ?? "").trim();
  if (!id) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-slate-700 dark:text-slate-300">Missing claim id.</p>
        <Button type="button" variant="outline" asChild>
          <Link href="/billing/insurance">Back to insurance</Link>
        </Button>
      </div>
    );
  }
  return <ClaimForm variant="view" claimId={id} title="Claim details" />;
}
