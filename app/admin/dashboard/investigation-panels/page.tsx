"use client";

import Link from "next/link";
import ClinicalConfigurationNav from "@/components/admin/ClinicalConfigurationNav";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function InvestigationPanelsPlaceholderPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Administration</p>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Clinical configuration</p>
              <ClinicalConfigurationNav />
            </div>
            <div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Investigation panels</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Configure investigation bundles for ordering workflows. This section is not wired yet.
              </p>
            </div>
          </div>
          <Button variant="outline" asChild>
            <Link href="/dashboard/admin">← Admin home</Link>
          </Button>
        </div>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Coming soon</CardTitle>
            <CardDescription>
              Investigation panel management will appear here alongside OPD templates and consent library.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
