import { ProcedureEstimateClient } from "./procedure-estimate-client";

type Props = {
  params: Promise<{ admissionId: string }>;
};

export default async function ProcedureEstimatePage({ params }: Props) {
  const { admissionId } = await params;
  const id = (admissionId ?? "").trim();
  if (!id) {
    return <p className="p-6 text-sm text-destructive">Missing admission.</p>;
  }
  return <ProcedureEstimateClient admissionId={id} />;
}
