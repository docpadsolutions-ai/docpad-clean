import Link from "next/link";

export default function DashboardSettingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold tracking-tight text-foreground">Settings</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Workspace preferences. Clinical configuration for administrators is available under the links below.
      </p>
      <section className="mt-8 max-w-xl rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">Clinical configuration</h2>
        <p className="mt-1 text-xs text-muted-foreground">Hospital administrators — templates, consents, and investigation panels.</p>
        <ul className="mt-4 space-y-2 text-sm">
          <li>
            <Link href="/admin/dashboard/templates" className="font-medium text-blue-600 hover:text-blue-700 hover:underline">
              OPD templates
            </Link>
          </li>
          <li>
            <Link href="/admin/dashboard/consent-templates" className="font-medium text-blue-600 hover:text-blue-700 hover:underline">
              Consent library
            </Link>
          </li>
          <li>
            <Link
              href="/admin/dashboard/investigation-panels"
              className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
            >
              Investigation panels
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
