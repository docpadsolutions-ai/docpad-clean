import Link from "next/link";
import { Button } from "../../../../../../components/ui/button";

type Props = { params: Promise<{ id: string }> };

export default async function EditVendorPage({ params }: Props) {
  const { id } = await params;
  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Edit vendor</h1>
        <p className="text-sm text-muted-foreground">
          Form for vendor <code className="rounded bg-muted px-1 text-xs">{id}</code> can be added next; list actions
          link here so the route exists.
        </p>
        <Button variant="outline" asChild>
          <Link href="/admin/pharmacy/vendors">← Vendors</Link>
        </Button>
      </div>
    </div>
  );
}
